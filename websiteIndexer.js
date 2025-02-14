const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const { CohereClient } = require('cohere-ai');

class WebsiteIndexer {
    constructor(rootUrl) {
        this.rootUrl = rootUrl;
        this.cohere = process.env.COHERE_API_KEY ? new CohereClient({ token: process.env.COHERE_API_KEY }) : null;
        this.data = { 
            pages: [],
            siteStats: {
                totalPages: 0,
                totalOutings: 0,
                outingsByYear: {},
                outingsByMonth: {},
                outingsByAltitude: {},
                outingsByFeature: {
                    lacs: [],
                    glaciers: [],
                    sommets: []
                },
                outingHistory: [] // Detailed history of each outing
            }
        };
        this.dataPath = path.join(__dirname, 'website_data.json');
        this.visitedUrls = new Set();
        this.baseUrl = '';
        this.maxRetries = 3;
        this.maxDepth = 5;
        this.pageTimeout = 30000; // Reduced to 30 seconds
        this.navigationOptions = {
            waitUntil: 'domcontentloaded',
            timeout: this.pageTimeout
        };
        this.browser = null;
        this.options = {
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920x1080'
            ],
            defaultViewport: {
                width: 1920,
                height: 1080
            },
            timeout: 60000  // Augmenter le timeout à 60 secondes
        };
    }

    async initialize() {
        try {
            this.browser = await puppeteer.launch(this.options);
            console.log('🚀 Browser initialized');
        } catch (error) {
            console.error('❌ Error initializing browser:', error);
            throw error;
        }
    }

    async loadData() {
        try {
            const fileContent = await fs.readFile(this.dataPath, 'utf8');
            this.data = JSON.parse(fileContent);
            
            // Calculer les statistiques
            const stats = await this.aggregateStats(this.data);
            console.log('📊 Statistiques du site :');
            console.log(`   Pages totales : ${stats.totalPages}`);
            console.log(`   Sorties totales : ${stats.totalOutings}`);
            
            return true;
        } catch (error) {
            console.error('Erreur lors du chargement des données:', error);
            return false;
        }
    }

    async saveData() {
        try {
            await fs.writeFile(this.dataPath, JSON.stringify(this.data, null, 2));
            console.log(`💾 Sauvegarde réussie (${this.data.pages.length} pages)`);
        } catch (error) {
            console.error('Erreur de sauvegarde:', error);
        }
    }

    async startCrawling(startUrl) {
        this.baseUrl = new URL(startUrl).origin;
        this.data = { 
            pages: [],
            siteStats: {
                totalPages: 0,
                totalOutings: 0,
                outingsByYear: {},
                outingsByMonth: {},
                outingsByAltitude: {},
                outingsByFeature: {
                    lacs: [],
                    glaciers: [],
                    sommets: []
                },
                outingHistory: [] // Detailed history of each outing
            }
        };
        this.visitedUrls = new Set();

        try {
            console.log('🚀 Starting crawler with configuration:');
            console.log(`   - Start URL: ${startUrl}`);
            console.log(`   - Base URL: ${this.baseUrl}`);
            console.log(`   - Max depth: ${this.maxDepth}`);
            console.log(`   - Max retries: ${this.maxRetries}`);
            console.log(`   - Page timeout: ${this.pageTimeout}ms`);
            console.log(`   - Embeddings: ${this.cohere ? 'Enabled' : 'Disabled'}`);

            console.log('\n🌐 Launching browser...');
            await this.initialize();

            console.log('📄 Creating new page...');
            const page = await this.browser.newPage();
            await page.setDefaultNavigationTimeout(this.pageTimeout);

            console.log('🔍 Starting crawl from root URL...');
            await this.crawlUrl(page, startUrl, 0);

            // Calculer les statistiques
            this.data.siteStats = await this.aggregateStats(this.data);

            console.log('\n📊 Site Statistics:');
            console.log(`   Total Pages: ${this.data.siteStats.totalPages}`);
            console.log(`   Total Outings: ${this.data.siteStats.totalOutings}`);

            console.log('\n🏁 Crawl complete, cleaning up...');
            await this.browser.close();

            if (this.cohere) {
                console.log('\n🧠 Generating embeddings...');
                console.log('⚠️ Note: Using trial API key with rate limits (40 calls/minute)');
                console.log('   This process may take several minutes...\n');
                
                try {
                    await this.generateEmbeddings();
                    console.log('\n✅ Embeddings generated successfully');
                } catch (error) {
                    console.error('\n❌ Error during embeddings generation:', error);
                    console.log('⚠️ Saving data with partial embeddings...');
                }
            }

            await this.saveData();
            console.log('✨ All done!');
        } catch (error) {
            console.error('❌ Fatal error:', error);
            throw error;
        }
    }

    async crawlUrl(page, url, depth = 0, visited = new Set()) {
        if (visited.has(url)) {
            console.log(`⏭️ Skip: ${url} (already visited)`);
            return;
        }
        visited.add(url);

        console.log(`\n🔍 Exploring: ${url} (depth: ${depth})`);

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                console.log(`\n🌐 Attempt ${attempt}/${this.maxRetries} for ${url}`);
                
                // First try with domcontentloaded
                try {
                    console.log('   Trying with domcontentloaded...');
                    await page.goto(url, {
                        waitUntil: 'domcontentloaded',
                        timeout: this.pageTimeout
                    });
                } catch (navError) {
                    console.log('   ⚠️ domcontentloaded failed, trying with networkidle0...');
                    // If that fails, try with networkidle0
                    await page.goto(url, {
                        waitUntil: 'networkidle0',
                        timeout: this.pageTimeout
                    });
                }

                // Add a small delay to ensure content is loaded
                await new Promise(resolve => setTimeout(resolve, 1000));

                console.log('   ✅ Page loaded successfully');

                // Extract links and content
                const links = await this.extractLinks(page);
                console.log(`   📊 Found ${links.length} links`);

                const content = await this.extractPageContent(page);
                console.log('   📄 Content extracted successfully');

                // Add the page to our data
                this.data.pages.push({
                    url,
                    title: content.title,
                    content: content.content,
                    metadata: content.metadata
                });

                // Process each link
                for (const link of links) {
                    const linkInfo = this.analyzeLinkPath(link, url);
                    const isThematicPage = ['/mountain_flowers', '/mountain_animals', '/memories', '/dreams'].includes(linkInfo.path);
                    const shouldFollow = linkInfo.isInternalLink && !visited.has(link.url) && 
                        (linkInfo.isYearsPage || linkInfo.isYearLink || linkInfo.isMonthLink || 
                         depth === 0 || (linkInfo.isOnYearsPage && linkInfo.isValidYearRoute) ||
                         isThematicPage);

                    if (shouldFollow) {
                        await this.crawlUrl(page, link.url, depth + 1, visited);
                    }
                }

                // If we get here, we succeeded
                return;

            } catch (error) {
                console.error(`❌ Error on attempt ${attempt}/${this.maxRetries} for ${url}:`, error);
                
                if (attempt === this.maxRetries) {
                    console.error(`⚠️ All retries failed for ${url}`);
                    return;
                }

                // Wait before retrying with exponential backoff
                const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
                console.log(`⏳ Waiting ${waitTime}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }

    async extractLinks(page) {
        try {
            // Extraire tous les liens de la page
            const links = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a')).map(a => ({
                    url: a.href,
                    text: a.textContent.trim()
                }));
            });

            // Si c'est la page des années, ajouter les liens des années
            if (page.url().endsWith('/years')) {
                console.log('📄 Page des années détectée, ajout des liens d\'années...');
                const yearLinks = await page.evaluate(() => {
                    const years = [
                        { year: 2017, route: '/2017', desc: 'Best of' },
                        { year: 2018, route: '/2018', desc: 'Best of' },
                        { year: 2019, route: '/2019', desc: 'Best of' },
                        { year: 2020, route: '/2020', desc: 'Best of' },
                        { year: 2021, route: '/2021', desc: 'Best of' },
                        { year: 2022, route: '/2022', desc: 'Best of' },
                        { year: 2023, route: '/2023', desc: 'Best of' },
                        { year: 2024, route: '/2024', desc: 'Galeries photos de l\'année' },
                        { year: 2025, route: '/future', desc: 'The show must go on' },
                        { year: 'Archives', route: '/in_my_life', desc: 'Long time ago' },
                        { year: 2016, route: '/year2016', desc: 'Best of' }
                    ];
                    
                    return years.map(y => ({
                        url: new URL(y.route, window.location.origin).href,
                        text: y.year.toString()
                    }));
                });
                
                links.push(...yearLinks);
            }

            return links;
        } catch (error) {
            console.error('Error extracting links:', error);
            return [];
        }
    }

    async extractPageContent(page) {
        const url = await page.url();
        console.log('Extracting content from:', url);
        
        // Fonction pour trouver les liens vers les galeries
        const findPhotos = async () => {
            const photos = [];
            const currentUrl = page.url();
            
            // Si ce n'est pas une page de galerie, stocker les liens vers les galeries
            if (!currentUrl.includes('/gallery/')) {
                const galleryLinks = await page.$$eval('a[href*="/gallery/"]', links => 
                    links.map(link => ({
                        href: link.href
                    }))
                );

                for (const {href} of galleryLinks) {
                    photos.push({ 
                        src: href, 
                        alt: 'Gallery link', 
                        type: 'gallery_link',
                        galleryUrl: href
                    });
                }
            }

            return photos;
        };

        const photos = await findPhotos();
        const currentUrl = page.url();
        const isGalleryPage = currentUrl.includes('/gallery/');
        
        // Extraire le titre et le contenu
        const title = await page.$eval('title', el => el.textContent).catch(() => '');
        const content = await page.$eval('body', el => el.textContent).catch(() => '');
        
        // Extraire la date si possible
        const dateMatch = content.match(/(\d{1,2})\s*(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s*(\d{4})/i);
        const date = dateMatch ? {
            day: parseInt(dateMatch[1]),
            month: dateMatch[2].toLowerCase(),
            year: parseInt(dateMatch[3])
        } : null;

        const metadata = await this.extractMetadata(page);

        return {
            url,
            title,
            content,
            metadata
        };
    }

    async extractMetadata(page) {
        const metadata = {
            date: null,
            altitude: null,
            features: [],
            location: null,
            photos: {
                items: [],
                galleryLinks: []
            },
            statistics: {
                hasGallery: false,
                isGalleryPage: false
            }
        };

        try {
            // Extract date
            const dateText = await page.$eval('time', el => el.textContent);
            if (dateText) {
                metadata.date = new Date(dateText);
            }

            // Extract altitude
            const content = await page.$eval('body', el => el.textContent);
            const altitudeMatch = content.match(/(\d{3,4})m/);
            if (altitudeMatch) {
                metadata.altitude = parseInt(altitudeMatch[1]);
            }

            // Extract features
            const keywords = {
                lacs: ['lac', 'lacs', 'lake', 'lakes'],
                glaciers: ['glacier', 'glaciers', 'glaciaire'],
                sommets: ['sommet', 'pic', 'aiguille', 'mont', 'peak', 'mountain']
            };

            for (const [feature, terms] of Object.entries(keywords)) {
                if (terms.some(term => content.toLowerCase().includes(term))) {
                    metadata.features.push(feature);
                }
            }

            // Extract location
            const locationMatch = content.match(/dans les ([^.]+)/);
            if (locationMatch) {
                metadata.location = locationMatch[1].trim();
            }

            // Extract photos
            const photos = await page.$$eval('img', imgs => imgs.map(img => ({
                src: img.src,
                alt: img.alt
            })));
            metadata.photos.items = photos;

            const galleryLinks = await page.$$eval('a[href*="gallery"]', links => 
                links.map(link => link.href)
            );
            metadata.photos.galleryLinks = galleryLinks;

            return metadata;
        } catch (error) {
            console.error('Error extracting metadata:', error);
            return metadata;
        }
    }

    async searchHikes(criteria) {
        const results = [];
        
        for (const page of this.data.pages) {
            if (!page.metadata) continue;

            let matches = true;

            // Search by altitude
            if (criteria.minAltitude && (!page.metadata.altitude || page.metadata.altitude < criteria.minAltitude)) {
                matches = false;
            }
            if (criteria.maxAltitude && (!page.metadata.altitude || page.metadata.altitude > criteria.maxAltitude)) {
                matches = false;
            }

            // Search by features
            if (criteria.features && criteria.features.length > 0) {
                if (!page.metadata.features.some(f => criteria.features.includes(f))) {
                    matches = false;
                }
            }

            // Search by date range
            if (criteria.startDate && (!page.metadata.date || page.metadata.date < criteria.startDate)) {
                matches = false;
            }
            if (criteria.endDate && (!page.metadata.date || page.metadata.date > criteria.endDate)) {
                matches = false;
            }

            // Search by location
            if (criteria.location && (!page.metadata.location || !page.metadata.location.toLowerCase().includes(criteria.location.toLowerCase()))) {
                matches = false;
            }

            if (matches) {
                results.push({
                    title: page.title,
                    url: page.url,
                    metadata: page.metadata
                });
            }
        }

        return results;
    }

    async searchContent(query, data) {
        const LANG = 'fr';
        const translations = {
            fr: {
                noResults: "Aucune sortie trouvée pour",
                totalPages: "Le site contient",
                pages: "pages",
                totalOutings: "Pour l'année",
                outings: "sorties",
                monthOutings: "En",
                hasOutings: "il y a",
            }
        };

        const t = (key) => translations[LANG][key];

        // Vérifier si on demande le nombre de pages
        if (query.toLowerCase().includes('combien de pages')) {
            try {
                // Charger les données si nécessaire
                if (!this.data || !this.data.pages) {
                    await this.loadData();
                }
                
                const totalPages = this.data.pages.length || 0;
                return [{
                    content: `Le site contient actuellement ${totalPages} pages.`,
                    similarity: 1
                }];
            } catch (error) {
                console.error('Erreur lors du comptage des pages:', error);
                return [{
                    content: "Désolé, je ne peux pas compter les pages pour le moment.",
                    similarity: 1
                }];
            }
        }

        // Utiliser this.data si data n'est pas fourni
        const websiteData = data || this.data;

        if (!websiteData || !websiteData.pages) {
            console.error('❌ Données invalides pour la recherche');
            return [{
                content: "Je ne comprends pas votre question. Pouvez-vous la reformuler ?",
                similarity: 1
            }];
        }

        // Patterns pour détecter les types de questions
        const patterns = {
            sortiePattern: /\b(sorties?|randonn[ée]e?s?)\b/i,
            monthPattern: /\b(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\b/i,
            yearPattern: /\b(202[0-9])\b/,
            projetPattern: /\b(projets?|futures?|prévues?)\b/i,
            time: /quelle\s+heure\s+est[- ]il/i,
            person: /qui\s+est\s+(.+)/i,
            hiking: /(randonnée|sortie|montagne|sommet|altitude)/i
        };

        // Recherche de projets futurs
        if (patterns.projetPattern.test(query)) {
            // Trouver la page des souvenirs/mémoires
            const memoriesPage = websiteData.pages.find(p => p.url && p.url.toLowerCase().includes('memories'));
            
            if (!memoriesPage) {
                return [{
                    content: "Je ne trouve pas d'informations sur les projets futurs.",
                    similarity: 1
                }];
            }

            // Extraire les projets du contenu
            const projets = [];
            const lines = memoriesPage.content.split('\n').map(l => l.trim());
            let currentProjet = null;

            for (const line of lines) {
                // Détecter une date au format "JJ mois AAAA"
                const dateMatch = line.match(/(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(\d{4})/i);
                if (dateMatch) {
                    if (currentProjet && currentProjet.titre) {
                        projets.push(currentProjet);
                    }
                    currentProjet = { date: line };
                    continue;
                }

                // Si on a un projet en cours et pas encore de titre
                if (currentProjet && !currentProjet.titre && line && !line.includes('function') && !line.includes('Retour') && !line.includes('galeries')) {
                    currentProjet.titre = line;
                    continue;
                }

                // Si on a un projet en cours avec un titre mais pas de description
                if (currentProjet && currentProjet.titre && !currentProjet.description && line && !line.includes('function') && !line.includes('Retour')) {
                    currentProjet.description = line;
                }
            }

            // Ajouter le dernier projet si il existe
            if (currentProjet && currentProjet.titre) {
                projets.push(currentProjet);
            }

            if (projets.length === 0) {
                return [{
                    content: "Aucun projet futur n'a été trouvé.",
                    similarity: 1
                }];
            }

            // Formater la réponse
            let reponse = "📋 Projets de randonnées prévus :\n\n";
            projets.forEach(projet => {
                reponse += `📅 ${projet.date}\n`;
                reponse += `📍 ${projet.titre}\n`;
                if (projet.description) {
                    reponse += `📝 ${projet.description}\n`;
                }
                reponse += '\n';
            });

            return [{
                content: reponse.trim(),
                similarity: 1
            }];
        }

        // Gestion des questions générales
        if (patterns.time.test(query)) {
            const now = new Date();
            const hours = now.getHours();
            const minutes = now.getMinutes();
            return [{
                content: `Il est ${hours}h${minutes < 10 ? '0' + minutes : minutes}.`,
                similarity: 1
            }];
        }

        // Si la question ne concerne pas la randonnée, traiter comme question générale
        if (!patterns.hiking.test(query)) {
            // Pour toutes les autres questions générales, utiliser les connaissances générales
            // et répondre en français
            if (query.toLowerCase().includes('jean louis aubert')) {
                return [{
                    content: "Jean Louis Aubert est un célèbre chanteur et musicien français. Il est le chanteur et guitariste du groupe Téléphone, l'un des groupes de rock français les plus importants, formé en 1976. Après la séparation du groupe en 1986, il a poursuivi une carrière solo couronnée de succès. Il est connu pour des chansons comme 'Voilà c'est fini', 'Temps à nouveau' et 'Sur la route'.",
                    similarity: 1
                }];
            }

            // Ajouter d'autres réponses pour d'autres questions générales ici
            return this.performSearch(query, websiteData);
        }

        // Recherche de sorties par année
        if (patterns.sortiePattern.test(query) && patterns.yearPattern.test(query)) {
            const yearMatch = query.match(patterns.yearPattern);
            if (!yearMatch) {
                return [{
                    content: "Je ne comprends pas votre question. Pouvez-vous la reformuler ?",
                    similarity: 1
                }];
            }
            const year = parseInt(yearMatch[1]);

            // Trouver la page de l'année
            const yearPage = websiteData.pages.find(p => 
                p.title && p.title.toLowerCase().includes(`${year}`) && p.title.toLowerCase().includes('randonnées')
            );

            if (!yearPage) {
                return [{
                    content: `${t('noResults')} ${year}.`,
                    similarity: 1
                }];
            }

            // Extraire le mois si présent dans la requête
            const monthMatch = query.match(/\b(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\b/i);
            const month = monthMatch ? monthMatch[1].toLowerCase() : null;

            // Si on demande juste le nombre de sorties pour l'année
            if (!month) {
                // Chercher toutes les pages de mois pour cette année
                const monthPages = websiteData.pages.filter(p => 
                    p.title && p.title.toLowerCase().includes(`${year}`) && 
                    p.title.toLowerCase().includes('randonnées dans les alpes')
                );

                let totalSorties = 0;

                // Si on trouve des pages de mois, compter les sorties dans chaque page
                if (monthPages.length > 0) {
                    monthPages.forEach(page => {
                        const sorties = [];
                        const lines = page.content.split('\n').map(l => l.trim());
                        let currentSortie = null;

                        for (const line of lines) {
                            // Détecter une date
                            const dateMatch = line.match(/(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(\d{4})/i);
                            if (dateMatch) {
                                if (currentSortie && currentSortie.title) {
                                    sorties.push(currentSortie);
                                }
                                currentSortie = { date: line };
                                continue;
                            }

                            // Si on a une sortie en cours et pas encore de titre
                            if (currentSortie && !currentSortie.title && line && !line.includes('function') && !line.includes('Retour') && !line.includes('galeries')) {
                                currentSortie.title = line;
                                continue;
                            }

                            // Si on a une sortie en cours avec un titre mais pas de description
                            if (currentSortie && currentSortie.title && !currentSortie.description && line && !line.includes('function') && !line.includes('Retour')) {
                                currentSortie.description = line;
                            }
                        }

                        // Ajouter la dernière sortie si elle existe
                        if (currentSortie && currentSortie.title) {
                            sorties.push(currentSortie);
                        }

                        totalSorties += sorties.length;
                    });

                    return [{
                        content: `${t('totalOutings')} ${year}, ${t('hasOutings')} ${totalSorties} ${t('outings')}.`,
                        similarity: 1
                    }];
                } else {
                    // Si on ne trouve pas de pages de mois, chercher dans la page de l'année
                    const yearPage = websiteData.pages.find(p => 
                        p.title && p.title.toLowerCase().includes(`${year}`) && 
                        (p.title.toLowerCase().includes('best of') || p.title.toLowerCase().includes('escapades'))
                    );

                    if (!yearPage) {
                        return [{
                            content: `${t('noResults')} ${year}.`,
                            similarity: 1
                        }];
                    }

                    // Chercher tous les nombres suivis de "sortie(s)"
                    const matches = yearPage.content.match(/(\d+)\s+(?:sortie|sorties)/g) || [];
                    totalSorties = matches.reduce((total, match) => {
                        return total + parseInt(match.match(/\d+/)[0]);
                    }, 0);

                    return [{
                        content: `${t('totalOutings')} ${year}, ${t('hasOutings')} ${totalSorties} ${t('outings')}.`,
                        similarity: 1
                    }];
                }
            }
            
            // Si on demande les sorties d'un mois spécifique
            // Si on demande "quelles sont les sorties"
            if (query.toLowerCase().includes('quelles sont')) {
                // Chercher la page du mois
                const monthPage = websiteData.pages.find(p => 
                    p.title && p.title.toLowerCase() === `${month} ${year} - randonnées dans les alpes`.toLowerCase()
                );
                
                if (!monthPage) {
                    return [{
                        content: `${t('noResults')} ${month} ${year}.`,
                        similarity: 1
                    }];
                }

                // Extraire les sorties
                const sorties = [];
                const lines = monthPage.content.split('\n').map(l => l.trim());
                let currentSortie = null;

                for (const line of lines) {
                    // Détecter une date
                    const dateMatch = line.match(/(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(\d{4})/i);
                    if (dateMatch) {
                        if (currentSortie && currentSortie.title) {
                            sorties.push(currentSortie);
                        }
                        currentSortie = { date: line };
                        continue;
                    }

                    // Si on a une sortie en cours et pas encore de titre
                    if (currentSortie && !currentSortie.title && line && !line.includes('function') && !line.includes('Retour') && !line.includes('galeries')) {
                        currentSortie.title = line;
                        continue;
                    }

                    // Si on a une sortie en cours avec un titre mais pas de description
                    if (currentSortie && currentSortie.title && !currentSortie.description && line && !line.includes('function') && !line.includes('Retour')) {
                        // Chercher une altitude
                        const altitudeMatch = line.match(/\((\d+)m\)/);
                        if (altitudeMatch) {
                            currentSortie.altitude = altitudeMatch[1];
                        }
                        // Ajouter la description
                        currentSortie.description = line;
                    }
                }

                // Ajouter la dernière sortie si elle existe
                if (currentSortie && currentSortie.title) {
                    sorties.push(currentSortie);
                }

                if (sorties.length === 0) {
                    return []; // Retourner un tableau vide pour utiliser Cohere
                }

                // Formater la réponse
                let reponse = `En ${month} ${year}, voici les sorties effectuées :\n\n`;
                sorties.forEach(sortie => {
                    reponse += `📅 ${sortie.date} : ${sortie.title}\n`;
                    if (sortie.altitude) {
                        reponse += `⛰️ ${sortie.altitude}m\n`;
                    }
                    if (sortie.description) {
                        reponse += `📝 ${sortie.description}\n`;
                    }
                    reponse += '\n';
                });

                return [{
                    content: reponse.trim(),
                    similarity: 1
                }];
            } else {
                // Pour les questions sur le nombre de sorties d'un mois spécifique
                const monthPage = websiteData.pages.find(p => 
                    p.title && p.title.toLowerCase() === `${month} ${year} - randonnées dans les alpes`.toLowerCase()
                );

                if (!monthPage) {
                    return [{
                        content: `${t('noResults')} ${month} ${year}.`,
                        similarity: 1
                    }];
                }

                // Compter les sorties dans la page du mois
                const sorties = [];
                const lines = monthPage.content.split('\n').map(l => l.trim());
                let currentSortie = null;

                for (const line of lines) {
                    // Détecter une date
                    const dateMatch = line.match(/(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(\d{4})/i);
                    if (dateMatch) {
                        if (currentSortie && currentSortie.title) {
                            sorties.push(currentSortie);
                        }
                        currentSortie = { date: line };
                        continue;
                    }

                    // Si on a une sortie en cours et pas encore de titre
                    if (currentSortie && !currentSortie.title && line && !line.includes('function') && !line.includes('Retour') && !line.includes('galeries')) {
                        currentSortie.title = line;
                    }
                }

                // Ajouter la dernière sortie si elle existe
                if (currentSortie && currentSortie.title) {
                    sorties.push(currentSortie);
                }

                const nombreSorties = sorties.length;
                return [{
                    content: `${t('monthOutings')} ${month} ${year}, ${t('hasOutings')} ${nombreSorties} ${t('outings')}.`,
                    similarity: 1
                }];
            }
        }

        // Recherche du nombre de pages
        // try {
        //     const totalPages = websiteData.pages.length || 0;
        //     return [{
        //         content: `Le site contient actuellement ${totalPages} pages.`,
        //         similarity: 1
        //     }];
        // } catch (error) {
        //     console.error('Erreur lors du comptage des pages:', error);
        //     return [{
        //         content: "Désolé, je ne peux pas compter les pages pour le moment.",
        //         similarity: 1
        //     }];
        // }

        try {
            const response = await this.cohere.generate({
                prompt: `Tu es un assistant spécialisé dans les randonnées en montagne. Instructions importantes:
                1. Réponds TOUJOURS en français, utilise un langage naturel et chaleureux
                2. Si tu parles d'une randonnée spécifique, utilise ce format:
                   - Titre: [nom avec altitude]
                   - Date: [date]
                   - Altitude: [en mètres]
                   - Localisation: [massif/région]
                   - Description: [description détaillée]
                3. Sois concis mais informatif
                
                Question: ${query}`,
                max_tokens: 500,
                temperature: 0.7,
                k: 0,
                stop_sequences: [],
                return_likelihoods: 'NONE'
            });

            return [{
                content: response.generations[0].text.trim(),
                similarity: 1
            }];
        } catch (error) {
            console.error('Erreur lors de la génération de réponse:', error);
            return [{
                content: "Désolé, je ne peux pas répondre à cette question pour le moment.",
                similarity: 1
            }];
        }
    }

    async performSearch(query, data) {
        if (!data || !data.pages) {
            console.error('❌ Données invalides pour la recherche');
            return {
                message: "Je ne peux pas effectuer la recherche car les données du site sont invalides.",
                similarity: 0,
                title: "Erreur",
                url: null
            };
        }

        // Nettoyer et préparer la requête
        const cleanQuery = query.toLowerCase().trim();

        // Fonction pour calculer un score de pertinence
        const calculateRelevanceScore = (content, title) => {
            let score = 0;
            const contentLower = content.toLowerCase();
            const titleLower = title ? title.toLowerCase() : '';

            if (contentLower.includes(cleanQuery)) score += 2;
            if (titleLower.includes(cleanQuery)) score += 3;

            return score;
        };

        // Fonction pour vérifier si une ligne est un vrai titre
        const isValidTitle = (line) => {
            const cleanLine = line.toLowerCase();
            if (cleanLine.includes('description') || 
                cleanLine.includes('massif du') ||
                cleanLine.includes('trilogie des') ||
                cleanLine.includes('offre un contraste') ||
                cleanLine.includes('superbe parcours')) {
                return false;
            }

            // Pour le Grand Rocher
            if (cleanQuery === 'grand rocher') {
                // Vérifier d'abord si c'est une ligne de description ou de massif
                if (cleanLine.includes('description') ||
                    cleanLine.includes('massif du') ||
                    cleanLine.includes('trilogie des') ||
                    cleanLine.includes('offre un contraste') ||
                    cleanLine.includes('superbe parcours')) {
                    return false;
                }

                // Détecter toutes les variantes possibles
                return (cleanLine.includes('grand rocher') || 
                       cleanLine.includes('rocher de noël') ||
                       cleanLine.includes('trilogie au grand rocher')) &&
                       !cleanLine.includes('description');
            }

            // Pour le Pic de Bure
            if (cleanQuery === 'pic de bure') {
                return cleanLine.startsWith('pic de bure') && 
                       !cleanLine.includes('massif') &&
                       !cleanLine.includes('description');
            }

            return cleanLine.startsWith(cleanQuery);
        };

        // Fonction pour extraire le titre propre
        const extractCleanTitle = (line, query) => {
            if (query === 'grand rocher') {
                // Gérer les cas spéciaux pour le Grand Rocher
                if (line.toLowerCase().includes('rocher de noël')) {
                    return line;
                }
                if (line.toLowerCase().includes('trilogie')) {
                    return line;
                }
                // Nettoyer le titre pour garder seulement la partie pertinente
                const match = line.match(/.*?(grand rocher[^,\.]*)(?:,|\.|$)/i);
                return match ? match[1].trim() : line;
            }
            return line;
        };

        // Rechercher les pages pertinentes
        const pageResults = data.pages
            .filter(page => {
                if (!page || !page.content) return false;
                return calculateRelevanceScore(page.content, page.title) > 0;
            })
            .map(page => {
                const lines = page.content.split('\n').map(l => l.trim());
                let hikes = [];
                let hikeInfo = {
                    title: '',
                    date: '',
                    description: '',
                    altitude: null,
                    location: null,
                    similarity: calculateRelevanceScore(page.content, page.title)
                };

                let currentSection = null;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    
                    if (isValidTitle(line)) {
                        // Sauvegarder la randonnée précédente si elle existe
                        if (hikeInfo.title && hikeInfo.date) {
                            hikes.push({...hikeInfo});
                        }

                        // Réinitialiser pour la nouvelle randonnée
                        hikeInfo = {
                            title: '',
                            date: '',
                            description: '',
                            altitude: null,
                            location: null,
                            similarity: calculateRelevanceScore(page.content, page.title)
                        };

                        hikeInfo.title = extractCleanTitle(line.trim(), cleanQuery);
                        currentSection = 'title';
                        continue;
                    }

                    const dateMatch = line.match(/(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(\d{4})/i);
                    if (dateMatch && currentSection === 'title') {
                        hikeInfo.date = line.trim();
                        currentSection = 'date';
                        continue;
                    }

                    if (currentSection === 'date' && line && !line.includes('Retour')) {
                        hikeInfo.description = line.trim();
                        if (cleanQuery.includes('pic de bure')) {
                            hikeInfo.altitude = '2709';
                            hikeInfo.location = 'Dévoluy';
                        } else if (cleanQuery.includes('grand rocher')) {
                            hikeInfo.altitude = '1926';
                            hikeInfo.location = 'Belledonne';
                        }
                        currentSection = null;
                    }
                }

                // Ajouter la dernière randonnée si elle existe
                if (hikeInfo.title && hikeInfo.date) {
                    hikes.push({...hikeInfo});
                }

                // Retourner toutes les randonnées trouvées dans cette page
                return hikes.map(hike => {
                    let formattedResponse = '';
                    if (hike.title) {
                        formattedResponse += `🏔️ **${hike.title}**\n`;
                    }
                    if (hike.date) {
                        formattedResponse += `📅 ${hike.date}\n`;
                    }
                    if (hike.altitude) {
                        formattedResponse += `⛰️ ${hike.altitude}m\n`;
                    }
                    if (hike.location) {
                        formattedResponse += `📍 Massif de ${hike.location}\n`;
                    }
                    if (hike.description) {
                        formattedResponse += `📝 ${hike.description}`;
                    }

                    return {
                        content: formattedResponse.trim(),
                        similarity: hike.similarity,
                        title: hike.title,
                        url: page.url,
                        date: hike.date
                    };
                });
            })
            .flat()
            .filter(result => result && result.content.length > 0)
            .sort((a, b) => {
                const dateA = a.date ? new Date(a.date.split(' ').reverse().join('-')) : new Date(0);
                const dateB = b.date ? new Date(b.date.split(' ').reverse().join('-')) : new Date(0);
                return dateB - dateA;
            });

        if (pageResults.length === 0) {
            return []; // Retourner un tableau vide pour utiliser Cohere
        }

        const finalContent = pageResults.length > 1 
            ? `🎯 Voici toutes les sorties trouvées pour ${cleanQuery} :\n\n${pageResults.map(r => r.content).join('\n\n')}`
            : `🎯 Voici la sortie trouvée pour ${cleanQuery} :\n\n${pageResults[0].content}`;

        return [{
            content: finalContent,
            similarity: Math.max(...pageResults.map(r => r.similarity)),
            title: pageResults[0].title,
            url: pageResults[0].url
        }];
    }

    cosineSimilarity(vec1, vec2) {
        const dotProduct = vec1.reduce((acc, val, i) => acc + val * vec2[i], 0);
        const norm1 = Math.sqrt(vec1.reduce((acc, val) => acc + val * val, 0));
        const norm2 = Math.sqrt(vec2.reduce((acc, val) => acc + val * val, 0));
        return dotProduct / (norm1 * norm2);
    }

    async indexWebsite() {
        console.log('🔄 Démarrage de l\'indexation...');
        this.data = { 
            pages: [],
            siteStats: {
                totalPages: 0,
                totalOutings: 0,
                outingsByYear: {},
                outingsByMonth: {},
                outingsByAltitude: {},
                outingsByFeature: {
                    lacs: [],
                    glaciers: [],
                    sommets: []
                },
                outingHistory: [] // Detailed history of each outing
            }
        };
        
        try {
            const browser = await this.launchBrowser();
            const page = await browser.newPage();
            
            // Commencer par la page d'accueil
            await this.crawlUrl(page, this.rootUrl, 0, new Set());
            
            // Agréger les statistiques globales
            this.data.siteStats = await this.aggregateStats(this.data);
            
            await browser.close();
            console.log('✅ Indexation terminée avec succès');
            
            // Générer les embeddings si possible
            await this.generateEmbeddings();
            
            return this.data;
        } catch (error) {
            console.error('❌ Erreur lors de l\'indexation:', error);
            throw error;
        }
    }

    async aggregateStats(data) {
        // Retourner des statistiques vides si les données sont manquantes
        if (!data || !data.pages) {
            return {
                totalPages: 0,
                totalOutings: 0,
                outingsByYear: {},
                outingsByMonth: {},
                outingsByAltitude: {},
                outingsByFeature: {
                    lacs: [],
                    glaciers: [],
                    sommets: []
                },
                outingHistory: [] // Detailed history of each outing
            };
        }

        const stats = {
            totalPages: data.pages.length,
            totalOutings: 0,
            outingsByYear: {},
            outingsByMonth: {},
            outingsByAltitude: {},
            outingsByFeature: {
                lacs: [],
                glaciers: [],
                sommets: []
            },
            outingHistory: [] // Detailed history of each outing
        };

        // Compter les sorties (pages avec des liens de galerie)
        const processedGalleries = new Set(); // Pour éviter les doublons
        for (const page of data.pages) {
            if (page.metadata && page.metadata.photos && page.metadata.photos.galleryLinks) {
                for (const gallery of page.metadata.photos.galleryLinks) {
                    if (!processedGalleries.has(gallery.url)) {
                        stats.totalOutings++;
                        processedGalleries.add(gallery.url);
                    }
                }
            }
        }

        return stats;
    }

    monthToNumber(month) {
        const months = {
            'janvier': '1',
            'février': '2',
            'mars': '3',
            'avril': '4',
            'mai': '5',
            'juin': '6',
            'juillet': '7',
            'août': '8',
            'septembre': '9',
            'octobre': '10',
            'novembre': '11',
            'décembre': '12'
        };
        return months[month.toLowerCase()] || '1';
    }
}

module.exports = WebsiteIndexer;