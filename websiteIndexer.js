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
        this.maxDepth = 10;
        this.pageTimeout = 60000; //larger time
        this.navigationOptions = {
            waitUntil: 'domcontentloaded',  // plus fast than 'networkidle0'
            timeout: 90000
        };
        this.validPaths = [
            '/inmy',
            '/mountain_flowers',
            '/mountain_animals',
            'wheel-of-fortune',
            'memories-of-centuries',
            'memories-shuffle',
            'projets'
            // Ajoutez toutes les routes valides ici
        ];
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
        this.cleanQuery = ''; // Ajout de la propriété cleanQuery
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
            this.data.siteStats = await this.aggregateStats(this.data); // Call aggregateStats to regenerate siteStats
            const stats = this.data.siteStats
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
        const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;

        if (visited.has(normalizedUrl)) {
            console.log(`⏭️ Skip: ${normalizedUrl} (already visited)`);
            return;
        }
        visited.add(normalizedUrl);

        console.log(`\n🔍 Exploring: ${url} (depth: ${depth})`);

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                console.log(`\n🌐 Attempt ${attempt}/${this.maxRetries} for ${url}`);

                // Ensuite on charge la page demandée
                try {
                    console.log('   Trying with domcontentloaded...');
                    await page.goto(url, this.navigationOptions);
                } catch (navError) {
                    console.log('   ⚠️ domcontentloaded failed, trying with networkidle0...');
                    await page.goto(url, {
                        waitUntil: 'networkidle0',
                        timeout: this.pageTimeout
                    });
                }

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
                    const shouldFollow = linkInfo.isInternalLink && !visited.has(link.url);

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
                        { year: 2016, route: '/2016', desc: 'Best of' },
                        { year: 2017, route: '/2017', desc: 'Best of' },
                        { year: 2018, route: '/2018', desc: 'Best of' },
                        { year: 2019, route: '/2019', desc: 'Best of' },
                        { year: 2020, route: '/2020', desc: 'Best of' },
                        { year: 2021, route: '/2021', desc: 'Best of' },
                        { year: 2022, route: '/2022', desc: 'Best of' },
                        { year: 2023, route: '/2023', desc: 'Best of' },
                        { year: 2024, route: '/2024', desc: 'Galeries photos de l\'année' },
                        { year: 2025, route: '/2025', desc: 'The show must go on' },
                        { year: 'Archives', route: '/inmy', desc: 'Long time ago' }
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

        const isGalleryPage = await page.evaluate(() => {
            return document.querySelector('meta[name="page-type"][content="gallery"], .gallery-grid') !== null;
        }) || url.includes('/gallery/');
        //New : check if it's a month page
        const isMonthPage = url.includes('/month/');

        let cleanedContent = '';
        let content = '';
        const metadata = {
            date: null,
            altitude: null,
            features: [],
            location: null,
            isProjectPage: false,
            projectsCount: 0,
            isGalleryPage
        };

        try {
            // Extraction du titre
            const title = await page.$eval('h1', el => el.textContent.trim()).catch(() => '');
            let cleanedTitle = title
                .replace(/- Randonnées dans les Alpes$/, '')
                .replace(/Galerie de Randonnées$/, '')
                .replace(/\s*-\s*$/, '')
                .trim();

            // Traitement des projets SANS code dur
            if (url.includes('/projets')) {
                const projects = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('.photo-card')).map(card => {
                        const hiddenData = card.querySelector('.hidden-data');
                        return {
                            title: card.querySelector('.photo-title')?.textContent?.trim() || '',
                            date: card.querySelector('.photo-date')?.textContent?.trim() || '',
                            description: hiddenData?.querySelector('p')?.textContent?.trim() || '',
                            image: card.querySelector('img')?.src || ''
                        };
                    });
                });

                cleanedTitle = "Projets 2025";
                metadata.isProjectPage = true;
                metadata.projectsCount = projects.length;

                return {
                    url,
                    title: cleanedTitle,
                    content: JSON.stringify(projects),
                    metadata
                };
            }

            // Extraction du contenu des galeries
            if (isGalleryPage) {
                content = await page.evaluate(() => {
                    // Try to get content in the metadata-block
                    const descriptionBlock = document.querySelector('.gallery-description, [itemprop="description"]');
                    if (descriptionBlock){
                        return descriptionBlock?.textContent ;
                    }else {
                       // If no description-block, try to get content in <p>
                       const paragraphs = Array.from(document.querySelectorAll('p'));
                       return paragraphs.find(p =>
                          p.textContent.match(/description|randonnée|ascension/i) &&
                          !p.textContent.match(/erreur|error/i)
                         )?.textContent || '';
                    }
                }).catch(() => '');
                cleanedContent = content
                    .replace(/(?:Voir les photos|Photo \d+\/\d+|\.$)/gi, '')
                    .replace(/\s{2,}/g, ' ')
                    .trim();

                // Extraction de la date améliorée avec fallback URL
                const dateMatch = content.match(/(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(\d{4})/i);
                const urlDateMatch = url.match(/\/(20\d{2})(?:\/month\/|\/)(\d{1,2})?/);

                // Ajouter cette vérification pour les pages /month/
                if (isMonthPage) {
                    metadata.date = null; // Désactive la date pour les pages mois
                } else if (dateMatch) {
                    metadata.date = `${dateMatch[1]} ${dateMatch[2].toLowerCase()} ${dateMatch[3]}`;
                } else if (urlDateMatch) {
                    const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
                    const monthIndex = urlDateMatch[2] ? parseInt(urlDateMatch[2]) - 1 : 0;
                    metadata.date = `15 ${months[monthIndex]} ${urlDateMatch[1]}`;
                }

            }



            // Appel de extractMetadata APRÈS avoir extrait les données de base
            const fullMetadata = await this.extractMetadata(
                page,
                isGalleryPage,
                cleanedTitle,
                 isMonthPage         //Pass if it's a month page
            );

            // Fusionner les métadonnées
            const finalMetadata = {
                ...metadata,
                ...fullMetadata
            };


            return {
                url,
                title: cleanedTitle,
                content: cleanedContent,
                metadata: finalMetadata // Utiliser les métadonnées complètes
            };

        } catch (error) {
            console.error('Erreur lors de l\'extraction:', error);
            return {
                url,
                title: 'Erreur d\'extraction',
                content: '',
                metadata
            };
        }
    }

    filterUnwantedLocationText(location) {
        if (!location) return location;

        // Regular expressions to match unwanted phrases anywhere in the string
        const unwantedPhrases = [
            /retour\s*(?:aux\s*galeries)?/gi, // 'gi' for global and case-insensitive
            /retour/gi  // just retour
        ];

        // Remove all occurrences of unwanted phrases
         for (const phrase of unwantedPhrases) {
             location = location.replace(phrase, '');
         }

        return location.trim();
    }
    async extractMetadata(page, isGalleryPage, cleanedTitle, isMonthPage) {
        const metadata = {
            date: null,
            altitude: null,
            features: [],
            location: null,
            isProjectPage: page.url().includes('/projets'),
            projectsCount: 0,
            isGalleryPage: isGalleryPage
        };

        try {
            // Utiliser le titre nettoyé passé en paramètre
            const title = cleanedTitle;
            let content = await page.$eval('body', el => {
                // Supprimer les éléments indésirables de manière plus exhaustive
                const unwantedSelectors = ['script', 'style', 'noscript', 'header', 'footer', 'nav', '.controls'];
                unwantedSelectors.forEach(selector => {
                    el.querySelectorAll(selector).forEach(e => e.remove());
                });
                return el.textContent;
            });
           // Normalize whitespace here before location detection
            content = content.replace(/\s+/g, ' ').trim();
             // Creation de la nouvelle valeur de fullText
            let fullText = `${content}`.toLowerCase(); // removed the title here
            

            if (isGalleryPage) {
                // Ajouter un fallback de date depuis le contenu
                if (!metadata.date) {
                    const contentDateMatch = content.match(/(\d{1,2}\s+\S+\s+\d{4})/i);
                    if (contentDateMatch) metadata.date = contentDateMatch[0];
                }
                if (metadata.date) {
                    const monthsMap = {
                        'January': 'janvier', 'February': 'février', 'March': 'mars',
                        'April': 'avril', 'May': 'mai', 'June': 'juin',
                        'July': 'juillet', 'August': 'août', 'September': 'septembre',
                        'October': 'octobre', 'November': 'novembre', 'December': 'décembre'
                    };

                    // Convertir format ISO ou anglais
                    metadata.date = metadata.date
                        .replace(/(\d{1,2}) (\w+) (\d{4})/, (_, j, m, a) =>
                            `${j} ${monthsMap[m] || m.toLowerCase()} ${a}`
                        )
                        .replace(/(\d{4})-(\d{2})-(\d{2})/, (_, a, m, j) =>
                            `${j} ${this.monthToFrench(parseInt(m))} ${a}`
                        );
                }

                // Modification de la détection d'altitude
                try {
                    const altitudeMatches = [
                        ...content.matchAll(/(\d{1,2}[ ,]?\d{3})\s*(?:m|mètres?|meters?)\b/gi),
                        ...title.matchAll(/(\d{1,2}[ ,]?\d{3})\s*(?:m|mètres?)\b/gi)
                    ];
                    if (altitudeMatches.length > 0) {
                        const altitudes = altitudeMatches
                            .map(m => parseInt(m[1].replace(/[ ,]/g, '')))
                            .filter(a => a > 100 && a < 9000);

                        if (altitudes.length > 0) {
                            metadata.altitude = Math.max(...altitudes);
                        }
                    }
                } catch (error) {
                    console.error('Erreur extraction altitude:', error);
                }

                // Features avec syntaxe corrigée + nouveaux keywords
                const featureKeywords = {
                    lacs: ['lac', 'étang', 'plan d\'eau', 'rivière', 'cascade', 'durance'],
                    sommets: ['sommet', 'pic', 'crête', 'aiguille', 'mont', 'arête', 'rocher', 'grésy']
                };

               
                metadata.features = Object.entries(featureKeywords)
                    .filter(([feature, terms]) =>
                        terms.some(term => fullText.includes(term))
                    ).map(([feature]) => feature);

                // Détection améliorée de la localisation

                const locationMatch = fullText.match(
                   /(?:(?:dans|sur|au|à la|vers|proche de|près de|au pied du|au pied de) (?:la|le|les)?\s+)(?:vallée d[eu]|lac d[eu]|montagne d[eu]|massif d[eu]|cirque d[eu]|col d[eu]|parc d[eu]|hameau d[eu])?\s+([A-ZÀ-ÿ][a-zÀ-ÿ-]+(?:\s+[A-ZÀ-ÿ][a-zÀ-ÿ-]+)*)(?!\s*\1)/i
                );
                if (locationMatch) {
                    // Apply the filter here
                    metadata.location = this.filterUnwantedLocationText(locationMatch[1].trim());
                } else {
                     const locationMatch2 = fullText.match(/([A-ZÀ-ÿ][a-zÀ-ÿ-]+(?:\s+[A-ZÀ-ÿ][a-zÀ-ÿ-]+)*)(?!\s*\1)/i);
                    if (locationMatch2) {
                        // Apply the filter here
                       metadata.location = this.filterUnwantedLocationText(locationMatch2[0].trim()); //change here : use locationMatch2[0]
                    } else {
                        const locationBlock = await page.evaluate(() => {
                            const locationElements = document.querySelectorAll('footer,nav,main');
                            const locations = [];
                            for (const element of locationElements) {
                                const cleanedText = element.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
                                // check if the value is not already in the metadata
                                if (cleanedText.match(/^[a-zà-ÿ ]+$/i) && !locations.includes(cleanedText)) {
                                    locations.push(cleanedText);
                                }
                            }
                             // remove duplicates and sort
                            const uniqueLocations = [...new Set(locations)].sort();
                            return uniqueLocations.length > 0 ? uniqueLocations : null;
                        });

                        if (locationBlock && locationBlock.length > 0) {
                            // Apply the filter here
                            
                             const cleanedLocation = this.filterUnwantedLocationText(locationBlock[0].trim());
                             
                                metadata.location = cleanedLocation;
                           

                        }

                    }
                }

                if (metadata.isProjectPage) {
                    try {
                        metadata.projectsCount = await page.$$eval('.photo-card', cards => cards.length);

                    } catch (error) {
                        console.error('Erreur metadata projets:', error);
                    }
                }
            }
        } catch (error) {
            console.error('Erreur metadata :', error);
        }
        // Supprimer la propriété description
        delete metadata.description;

        return metadata;
    }

    // Helper pour les mois numériques
    monthToFrench(monthNumber) {
        const months = ['janvier','février','mars','avril','mai','juin',
                        'juillet','août','septembre','octobre','novembre','décembre'];
        return months[monthNumber - 1] || '';
    }

    async searchHikes(criteria) {
        const results = [];
        
        for (const page of this.data.pages) {
            if (!page.metadata) continue;

            let matches = true;

            // Search by altitude
            if (criteria.minAltitude) {
                matches = matches && (page.metadata.altitude >= criteria.minAltitude);
            }
            
            if (criteria.maxAltitude) {
                matches = matches && (page.metadata.altitude <= criteria.maxAltitude);
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
                    content: page.content || 'Pas de description disponible',
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
            projetPattern: /\b(projets?|futures?|prévues?|quels?\s*sont\s*les\s*projets?)\b/i,
            time: /quelle\s+heure\s+est[- ]il/i,
            person: /qui\s+est\s+(.+)/i,
            hiking: /(randonnée|sortie|montagne|sommet|altitude)/i,
            askingCount: /combien/i, // Nouveau pattern pour "combien"
        };
        
        // Rechercher le nombre de sorties pour une année
        if (patterns.sortiePattern.test(query) && patterns.yearPattern.test(query) && !patterns.monthPattern.test(query)) {
             const yearMatch = query.match(patterns.yearPattern);
             if(yearMatch){
                const year = parseInt(yearMatch[1]);
                const count = this.data.siteStats.outingsByYear[year] || 0;
                  return [{
                content: `${patterns.askingCount.test(query)?'Il y a ':""}${count} sortie${count > 1 ? 's' : ''} en ${year}.`,
                    similarity: 1
                }];
                }

        }

        // Recherche de projets futurs

        if (patterns.projetPattern.test(query)) {

            const projetsPage = websiteData.pages.find(p => 
                p.metadata?.isProjectPage 
            );

               if (!projetsPage) {
                return [{ content: "Aucun projet trouvé.", similarity: 1 }];
            }

            try {
                // Parser le contenu JSON des projets
                const projets = JSON.parse(projetsPage.content);

                // Trier les projets par date
                projets.sort((a, b) => new Date(a.date) - new Date(b.date));

                // Formater la réponse
                let reponse = `📋 Il y a actuellement ${projets.length} projets prévus pour 2025 :\n\n`;

                projets.forEach(projet => {
                    reponse += `📅 ${projet.date}\n`;
                    reponse += `📍 **${projet.title}**\n`;
                    reponse += `📝 ${projet.description}\n\n`;
                });

                return [{ 
                    content: reponse.trim(), 
                    similarity: 1,
                    isProject: true,
                    metadata: projetsPage.metadata // Transmettre les métadonnées
                }];           
            } catch (error) {
                console.error('Erreur parsing projets:', error);
                return [{
                    content: "Désolé, je ne peux pas lire les projets pour le moment.",
                    similarity: 1
                }];
            }
        }

        // Traiter les questions sur les sorties par année ou par mois
        if (patterns.sortiePattern.test(query)) {
            const yearMatch = query.match(patterns.yearPattern);
            const monthMatch = query.match(patterns.monthPattern);
            const askingCount = query.toLowerCase().includes('combien');
            
            // Réponse pour année spécifique
            if (yearMatch && !monthMatch) {
                const year = parseInt(yearMatch[1]);
                const count = this.data.siteStats.outingsByYear[year] || 0;
                return [{
                    content: `${patterns.askingCount.test(query)?'Il y a ':""}${count} sortie${count > 1 ? 's' : ''} en ${year}.`,
                    similarity: 1
                }];
            }
            
            // Réponse pour mois spécifique
            if (yearMatch && monthMatch) {
                const year = parseInt(yearMatch[1]);
                const month = this.frenchMonthToNumber(monthMatch[1]);
                const count = this.data.siteStats.outingsByMonth[year]?.[month] || 0;
                
                return [{
                    content: `${patterns.askingCount.test(query)?'Il y a ':""}${count} sortie${count > 1 ? 's' : ''} en ${monthMatch[1]} ${year}.`,
                    similarity: 1
                }];
            }    
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

        // Traiter comme recherche générale
        return this.performSearch(query, websiteData);
        
    }


    // Ajouter cette méthode utilitaire
    frenchMonthToNumber(frenchMonth) {
        const months = {
            'janvier': 1, 'février': 2, 'mars': 3, 'avril': 4,
            'mai': 5, 'juin': 6, 'juillet': 7, 'août': 8,
            'septembre': 9, 'octobre': 10, 'novembre': 11, 'décembre': 12
        };
        return months[frenchMonth.toLowerCase()] || 0;
    }

    
    // Fonction pour extraire le titre propre
    extractCleanTitle(line, query) {
        return line;
    }
    
    // Fonction pour vérifier si une ligne est un vrai titre
    isValidTitle(line) {
        const cleanLine = line.toLowerCase();
        if (cleanLine.includes('description') ||
            cleanLine.includes('massif du') ||
            cleanLine.includes('trilogie des') ||
            cleanLine.includes('offre un contraste') ||
            cleanLine.includes('superbe parcours')) {
            return false;
        }
        return true;
    }
    
    // Fonction pour calculer un score de pertinence
    calculateRelevanceScore(content, title) {
        let score = 0;
        const cleanQuery = this.cleanQuery
        const contentLower = content.toLowerCase();
        const titleLower = title ? title.toLowerCase() : '';

        if (cleanQuery.split(' ').length > 1) {
            if (contentLower.includes(cleanQuery)) score += 2;
            if (titleLower.includes(cleanQuery)) score += 3;
        } else {
            if (contentLower.includes(cleanQuery)) score += 1; // Priorité à la correspondance dans le contenu
            if (titleLower.includes(cleanQuery)) score += 2; // Priorité plus élevée si la correspondance est dans le titre
        }
        return score;
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
        this.cleanQuery = query.toLowerCase().trim();

        // Rechercher les pages pertinentes
        const pageResults = data.pages
            .filter(page => {
                if (!page || !page.content) return false;
                return this.calculateRelevanceScore(page.content, page.title) > 0;
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
                    similarity: this.calculateRelevanceScore(page.content, page.title)
                };

                let currentSection = null;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];

                    if (this.isValidTitle(line)) {
                        // Sauvegarder la randonnée précédente si elle existe
                        if (hikeInfo.title && hikeInfo.date) {
                            hikes.push({ ...hikeInfo });
                        }

                        // Réinitialiser pour la nouvelle randonnée
                        hikeInfo = {
                            title: '',
                            date: '',
                            description: '',
                            altitude: null,
                            location: null,
                            similarity: this.calculateRelevanceScore(page.content, page.title)
                        };
                        hikeInfo.title = this.extractCleanTitle(line.trim(), this.cleanQuery);
                        currentSection = 'title';
                        continue;
                    }

                    const dateMatch = line.match(/(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)/i);
                    if (dateMatch && currentSection === 'title') {
                        hikeInfo.date = line.trim();
                        currentSection = 'date';
                        continue;
                    }

                    if (currentSection === 'date' && line && !line.includes('Retour')) {
                        hikeInfo.description = line.trim();
                        currentSection = null;
                    }
                }
                 // Ajouter la dernière randonnée si elle existe
                 if (hikeInfo.title && hikeInfo.date) {
                   hikes.push({ ...hikeInfo });
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
                                formattedResponse += `📍 ${hike.location}\n`;
                            }
                            if (hike.description) {
                                formattedResponse += `📝 ${hike.description}`;
                            }

                            return {
                                content: formattedResponse.trim().replace(/\s+/g, ' '), //clean here !
                                similarity: hike.similarity,
                                title: hike.title,
                                url: page.url
                            };
                        });
            }).flat();

        return pageResults;
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
            }
        };

        data.pages.forEach(page => {
            if (page.metadata?.isGalleryPage && page.metadata.date) {
                const [day, monthFR, year] = page.metadata.date.split(' ');
                if (year >= 2000 && year <= 2100) {
                    stats.totalOutings++;
                    stats.outingsByYear[year] = (stats.outingsByYear[year] || 0) + 1;

                    const month = this.frenchMonthToNumber(monthFR);
                    if (month) {
                        stats.outingsByMonth[year] = stats.outingsByMonth[year] || {};
                        stats.outingsByMonth[year][month] = (stats.outingsByMonth[year][month] || 0) + 1;
                    }
                }
            }
        });

        return stats;
    }

    frenchMonthToNumber(month) {
        const months = {
            'janvier': 1, 'février': 2, 'mars': 3, 'avril': 4,
            'mai': 5, 'juin': 6, 'juillet': 7, 'août': 8,
            'septembre': 9, 'octobre': 10, 'novembre': 11, 'décembre': 12
        };
        return months[month.toLowerCase()] || 0;
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

    analyzeLinkPath(link, parentUrl) {
        const urlObj = new URL(link.url);
        const parentUrlObj = new URL(parentUrl);
        const yearMatch = urlObj.pathname.match(/\/(\d{4})\.html/);

        return {
            isInternalLink: urlObj.origin === this.baseUrl,
            isYearPage: !!yearMatch,
            year: yearMatch ? parseInt(yearMatch[1]) : null,
            isSpecialPage: this.validPaths.some(path => urlObj.pathname.startsWith(path)),

            path: urlObj.pathname,
            url: link.url,
            isYearLink: /\/(20\d{2})/.test(urlObj.pathname),
            isMonthLink: /\/month\/\d{4}\/\d{1,2}/.test(urlObj.pathname),
            isValidPath: this.validPaths.includes(urlObj.pathname),
        };
    }

    async generateEmbeddings() {
        console.log('⚠️ Embeddings non implémentés dans cette version');
        return; // À implémenter ultérieurement
    }
}
module.exports = WebsiteIndexer;
