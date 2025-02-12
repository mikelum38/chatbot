const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const { CohereClient } = require('cohere-ai');

class WebsiteIndexer {
    constructor() {
        // Make Cohere client optional
        this.cohere = process.env.COHERE_API_KEY ? new CohereClient({ token: process.env.COHERE_API_KEY }) : null;
        this.data = { pages: [] };
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
    }

    async loadData() {
        try {
            const exists = await fs.access(this.dataPath).then(() => true).catch(() => false);
            if (exists) {
                const rawData = await fs.readFile(this.dataPath, 'utf8');
                this.data = JSON.parse(rawData);
                console.log(`✅ Données chargées: ${this.data.pages.length} pages`);
            } else {
                console.log('⚠️ Pas de données existantes');
                this.data = { pages: [] };
            }
        } catch (error) {
            console.error('❌ Erreur de chargement:', error);
            this.data = { pages: [] };
        }
    }

    async saveData() {
        try {
            await fs.writeFile(this.dataPath, JSON.stringify(this.data, null, 2));
            console.log(`💾 Sauvegarde réussie (${this.data.pages.length} pages)`);
        } catch (error) {
            console.error('❌ Erreur de sauvegarde:', error);
        }
    }

    async startCrawling(startUrl) {
        this.baseUrl = new URL(startUrl).origin;
        this.data = { 
            pages: [],
            siteStats: {
                totalPages: 0,
                thematicPages: 0
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
            const browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
                defaultViewport: null
            });

            console.log('📄 Creating new page...');
            const page = await browser.newPage();
            await page.setDefaultNavigationTimeout(this.pageTimeout);

            console.log('🔍 Starting crawl from root URL...');
            await this.crawlUrl(page, startUrl, 0);

            // Calculer les statistiques
            this.data.siteStats.totalPages = this.data.pages.length;
            this.data.siteStats.thematicPages = this.data.pages.filter(page => {
                const path = new URL(page.url).pathname;
                return ['/mountain_flowers', '/mountain_animals', '/memories', '/dreams'].includes(path);
            }).length;

            console.log('\n📊 Site Statistics:');
            console.log(`   Total Pages: ${this.data.siteStats.totalPages}`);
            console.log(`   Thematic Pages: ${this.data.siteStats.thematicPages}`);

            console.log('\n🏁 Crawl complete, cleaning up...');
            await browser.close();

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
                    content: content.text,
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
                        { year: 2023, route: '/bestof', desc: 'Best of' },
                        { year: 2024, route: '/index', desc: 'Galeries photos de l\'année' },
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
        try {
            // Attendre que le contenu soit chargé
            await page.waitForSelector('body');

            const content = await page.evaluate(() => {
                const extractText = (element) => element ? element.innerText.trim() : '';

                // Récupérer le contenu textuel
                const title = document.title;
                const bodyText = document.body.innerText;

                // Compter les photos
                const images = Array.from(document.querySelectorAll('img')).map(img => ({
                    src: img.src,
                    alt: img.alt || ''
                }));

                // Détecter les projets et collections
                const projectKeywords = ['projet', 'galerie', 'collection', 'série', 'exposition'];
                const projects = [];
                const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
                headings.forEach(heading => {
                    const text = heading.innerText.toLowerCase();
                    if (projectKeywords.some(keyword => text.includes(keyword))) {
                        projects.push(heading.innerText.trim());
                    }
                });

                // Extraire la date si présente
                const dateMatch = bodyText.match(/(\d{1,2})\s*(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s*(\d{4})/i);
                const date = dateMatch ? {
                    day: parseInt(dateMatch[1]),
                    month: dateMatch[2].toLowerCase(),
                    year: parseInt(dateMatch[3])
                } : null;

                // Compter les liens
                const links = document.querySelectorAll('a[href]');
                const linkStats = {
                    total: links.length,
                    internal: Array.from(links).filter(a => a.href.startsWith(window.location.origin)).length,
                    external: Array.from(links).filter(a => !a.href.startsWith(window.location.origin)).length
                };

                // Détecter si c'est une page thématique
                const path = window.location.pathname;
                const isThematicPage = ['/mountain_flowers', '/mountain_animals', '/memories', '/dreams'].includes(path);

                return {
                    title,
                    text: bodyText,
                    metadata: {
                        date,
                        photos: {
                            count: images.length,
                            items: images
                        },
                        projects,
                        statistics: {
                            totalLinks: linkStats.total,
                            internalLinks: linkStats.internal,
                            externalLinks: linkStats.external,
                            totalImages: images.length
                        },
                        isThematicPage,
                        path
                    }
                };
            });

            // Mettre à jour les statistiques du site
            if (!this.data.siteStats) {
                this.data.siteStats = {
                    totalPages: 0,
                    totalPhotos: 0,
                    totalProjects: [],
                    photosByMonth: {},
                    photosByYear: {}
                };
            }

            this.data.siteStats.totalPages++;
            if (content.metadata.isThematicPage) {
                this.data.siteStats.thematicPages++;
            }

            return content;
        } catch (error) {
            console.error(`❌ Erreur lors de l'extraction du contenu pour ${page.url()}:`, error);
            return {
                url: page.url(),
                title: await page.title(),
                text: '',
                metadata: {}
            };
        }
    }

    analyzeLinkPath(link, currentUrl) {
        const url = new URL(link.url);
        const path = url.pathname;
        
        const isInternalLink = link.url.startsWith(this.baseUrl);
        const isYearsPage = path === '/years';
        const isYearLink = /^\/20\d{2}$/.test(path);
        const isMonthLink = /^\/month\/20\d{2}\/\d{1,2}$/.test(path);
        const isOnYearsPage = currentUrl.endsWith('/years');
        const isValidYearRoute = /^\/(20\d{2}|bestof|index|future|in_my_life|year2016)$/.test(path);
        
        return {
            path,
            isInternalLink,
            isYearsPage,
            isYearLink,
            isMonthLink,
            isOnYearsPage,
            isValidYearRoute
        };
    }

    async generateEmbeddings() {
        if (!this.cohere) {
            throw new Error('Cohere client not initialized');
        }

        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        const BATCH_SIZE = 20; // Process 20 items per batch
        const RATE_LIMIT_DELAY = 3000; // 3 seconds between calls
        const BATCH_DELAY = 70000; // 70 seconds between batches
        const MAX_RETRIES = 3;

        let processedCount = 0;
        const totalPages = this.data.pages.length;
        
        // Group pages into batches
        const batches = [];
        const pagesToProcess = this.data.pages.filter(page => !page.embedding);
        
        for (let i = 0; i < pagesToProcess.length; i += BATCH_SIZE) {
            batches.push(pagesToProcess.slice(i, i + BATCH_SIZE));
        }

        console.log(`\n📦 Processing ${pagesToProcess.length} pages in ${batches.length} batches`);
        console.log(`   Batch size: ${BATCH_SIZE}`);
        console.log(`   Delay between calls: ${RATE_LIMIT_DELAY/1000}s`);
        console.log(`   Delay between batches: ${BATCH_DELAY/1000}s\n`);
        
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            console.log(`\n🔄 Processing batch ${batchIndex + 1}/${batches.length}`);

            for (const page of batch) {
                // Skip if content is empty or invalid
                if (!page.content || typeof page.content !== 'string' || page.content.trim().length === 0) {
                    console.log(`⚠️ Skipping ${page.url} - Invalid or empty content`);
                    continue;
                }

                let retries = 0;
                let success = false;

                while (retries < MAX_RETRIES && !success) {
                    try {
                        const response = await this.cohere.embed({
                            texts: [page.content],
                            model: 'embed-english-v3.0',
                            truncate: 'END',
                            input_type: 'search_document'  // Add the required input_type parameter
                        });

                        page.embedding = response.embeddings[0];
                        processedCount++;
                        success = true;
                        
                        console.log(`✓ Generated embedding for ${page.url} (${processedCount}/${pagesToProcess.length})`);
                        await delay(RATE_LIMIT_DELAY);
                        
                    } catch (error) {
                        if (error.statusCode === 429) {
                            retries++;
                            console.log(`\n⚠️ Rate limit hit, retry ${retries}/${MAX_RETRIES}`);
                            await delay(BATCH_DELAY); // Wait full batch delay on rate limit
                        } else {
                            console.error(`❌ Error generating embedding for ${page.url}:`, error);
                            break;
                        }
                    }
                }
            }

            // Save progress after each batch
            console.log('\n💾 Saving batch progress...');
            await this.saveData();

            // Wait between batches unless it's the last batch
            if (batchIndex < batches.length - 1) {
                console.log(`\n⏳ Waiting ${BATCH_DELAY/1000} seconds before next batch...`);
                await delay(BATCH_DELAY);
            }
        }

        // Final save and report
        await this.saveData();
        const skippedPages = totalPages - processedCount;
        console.log(`\n✅ Embedding generation complete:`);
        console.log(`   - Total pages: ${totalPages}`);
        console.log(`   - Successfully processed: ${processedCount}`);
        console.log(`   - Already had embeddings: ${totalPages - pagesToProcess.length}`);
        console.log(`   - Failed/skipped: ${skippedPages}`);
    }

    async searchContent(query, maxResults = 5) {
        if (!this.data.pages || this.data.pages.length === 0) {
            console.log('⚠️ No pages to search');
            return [];
        }

        // Normalize query
        const escapeRegExp = (string) => {
            return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        };

        const searchTerms = query.toLowerCase().split(/\s+/).map(escapeRegExp);
        
        // Handle project listing
        const patterns = {
            projects: /quels?\s+(?:sont|est)\s+les?\s+projets?|projets?\s+cités?/i,
            pages: /combien.*pages|nombre.*pages/i,
            photosYear: /combien\s+de\s+photos?\s+en\s+(\d{4})/i,
            photosDate: /combien.*photos?\s+pour\s+(?:la\s+sortie\s+du\s+)?(\d{1,2})(?:er|ere)?\s+(\w+)\s+(\d{4})/i
        };

        // Handle project listing
        if (patterns.projects.test(query.toLowerCase())) {
            // Only look for projects in the memories page
            const memoriesPage = this.data.pages.find(page => 
                page.url.includes('/memories')
            );

            if (memoriesPage) {
                // Extract project names from the content
                const projectLines = memoriesPage.content
                    .split('\n')
                    .filter(line => line.trim().length > 0)
                    .filter(line => !line.toLowerCase().includes('retour'));

                if (projectLines.length > 0) {
                    if (query.toLowerCase().includes('quels')) {
                        return [{
                            url: 'stats://projects/list',
                            title: 'Liste des projets',
                            content: projectLines.join('\n'),
                            score: 1
                        }];
                    } else {
                        return [{
                            url: 'stats://projects/count',
                            title: 'Nombre de projets',
                            content: `Il y a ${projectLines.length} projets sur ce site.`,
                            score: 1
                        }];
                    }
                }
            }
            
            return [{
                url: 'stats://projects/notfound',
                title: 'Projets',
                content: 'Je suis désolé, je n\'ai pas trouvé la liste des projets sur le site.',
                score: 1
            }];
        }

        // Handle page count
        if (patterns.pages.test(query.toLowerCase())) {
            const totalPages = this.data.pages.length;
            const thematicPages = this.data.pages.filter(page => {
                const path = new URL(page.url).pathname;
                return ['/mountain_flowers', '/mountain_animals', '/memories', '/dreams'].includes(path);
            }).length;

            return [{
                url: 'stats://pages',
                title: 'Statistiques du site',
                content: `Le site contient ${totalPages} pages au total, dont ${thematicPages} pages thématiques.`,
                score: 1
            }];
        }

        // Handle photos by month and year
        const monthYearPattern = /photos.*(?:pour|de|en).*(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(\d{4})/i;
        const monthYearMatch = query.toLowerCase().match(monthYearPattern);
        if (monthYearMatch) {
            const [, month, year] = monthYearMatch;
            // Chercher d'abord la page spécifique du mois
            const monthPage = this.data.pages.find(page => {
                return page.url.toLowerCase().includes(`/${year}/`) && 
                       page.title.toLowerCase().includes(month.toLowerCase()) &&
                       page.title.toLowerCase().includes(year);
            });

            if (monthPage) {
                const totalPhotos = monthPage.metadata?.photos?.count || 0;
                return [{
                    url: 'stats://photos/month',
                    title: `Photos de ${month} ${year}`,
                    content: `Pour le mois de ${month} ${year}, j'ai trouvé ${totalPhotos} photos pour les sorties de randonnée. Les sources sont : "${monthPage.title}"`,
                    score: 1
                }];
            } else {
                return [{
                    url: 'stats://photos/month',
                    title: `Photos de ${month} ${year}`,
                    content: `Je n'ai pas trouvé de sorties documentées pour ${month} ${year}.`,
                    score: 1
                }];
            }
        }

        // Handle photos by year
        const yearMatch = query.toLowerCase().match(patterns.photosYear);
        if (yearMatch) {
            const year = yearMatch[1];
            // Chercher d'abord la page spécifique de l'année
            const yearPage = this.data.pages.find(page => {
                return page.url.toLowerCase() === `https://hiking-gallery.vercel.app/${year}`.toLowerCase() ||
                       page.url.toLowerCase() === `https://hiking-gallery.vercel.app/${year}/`.toLowerCase();
            });

            if (yearPage) {
                // Chercher toutes les pages de sorties pour cette année
                const monthPages = this.data.pages.filter(page => {
                    return page.url.toLowerCase().includes(`/${year}/`) && 
                           page.metadata?.date?.year === parseInt(year);
                });

                // Trouver la page avec le plus de photos
                const pageWithMostPhotos = monthPages.reduce((max, page) => {
                    const photoCount = page.metadata?.photos?.count || 0;
                    return photoCount > (max?.metadata?.photos?.count || 0) ? page : max;
                }, null);

                if (pageWithMostPhotos) {
                    const photoCount = pageWithMostPhotos.metadata?.photos?.count || 0;
                    return [{
                        url: 'stats://photos/year',
                        title: `Photos en ${year}`,
                        content: `En ${year}, il y avait ${photoCount} photos sur le site, toutes prises lors d'une même sortie. Ces informations proviennent de la page "Photos en ${year}"`,
                        score: 1
                    }];
                }
            }
            
            return [{
                url: 'stats://photos/year',
                title: `Photos en ${year}`,
                content: `Je n'ai pas trouvé de sorties documentées pour l'année ${year}.`,
                score: 1
            }];
        }

        // If no special case matches, use standard search
        return this.standardSearch(query, maxResults);
    }

    standardSearch(query, maxResults) {
        // Escape special characters in search terms
        const escapeRegExp = (string) => {
            return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        };

        const searchTerms = query.toLowerCase().split(/\s+/).map(escapeRegExp);
        
        return this.data.pages
            .map(page => {
                const score = searchTerms.reduce((acc, term) => {
                    const contentScore = (page.content.toLowerCase().match(new RegExp(term, 'g')) || []).length;
                    const titleScore = (page.title.toLowerCase().match(new RegExp(term, 'g')) || []).length * 2;
                    return acc + contentScore + titleScore;
                }, 0);
                
                return { page, score };
            })
            .filter(result => result.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, maxResults)
            .map(result => ({
                url: result.page.url,
                title: result.page.title,
                content: result.page.content,
                score: result.score
            }));
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
                totalPhotos: 0,
                totalProjects: [],
                photosByMonth: {},
                photosByYear: {}
            }
        };
        
        try {
            const browser = await this.launchBrowser();
            const page = await browser.newPage();
            
            // Commencer par la page d'accueil
            await this.crawlUrl(page, this.rootUrl, 0, new Set());
            
            // Agréger les statistiques globales
            this.data.siteStats = this.aggregateStats();
            
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

    aggregateStats() {
        const stats = {
            totalPages: this.data.pages.length,
            totalPhotos: 0,
            totalProjects: new Set(),
            photosByMonth: {},
            photosByYear: {}
        };

        this.data.pages.forEach(page => {
            // Compter les photos
            const photoCount = page.metadata?.photos?.count || 0;
            stats.totalPhotos += photoCount;

            // Collecter les projets uniques
            if (page.metadata?.projects) {
                page.metadata.projects.forEach(project => stats.totalProjects.add(project));
            }

            // Organiser les photos par date
            if (page.metadata?.date && photoCount > 0) {
                const { month, year } = page.metadata.date;
                
                // Par mois
                const monthKey = `${month}-${year}`;
                stats.photosByMonth[monthKey] = (stats.photosByMonth[monthKey] || 0) + photoCount;
                
                // Par année
                stats.photosByYear[year] = (stats.photosByYear[year] || 0) + photoCount;
            }
        });

        // Convertir le Set de projets en array
        stats.totalProjects = Array.from(stats.totalProjects);

        return stats;
    }
}

module.exports = WebsiteIndexer;