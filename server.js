const express = require('express');
const cors = require('cors');
const path = require('path');
const WebsiteIndexer = require('./websiteIndexer');
const { CohereClient } = require('cohere-ai');
require('dotenv').config();

const app = express();
const websiteIndexer = new WebsiteIndexer();
const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });
let dataLoaded = false;
let previousMessages = [];

app.use(cors());
app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper functions
function formatProjectResponse(projects) {
    if (!projects || projects.length === 0) {
        return "Je n'ai pas trouvé de projets.";
    }

    let response = `📋 Il y a actuellement ${projects.length} projets prévus pour 2025 :\n\n`;
    projects.forEach(projet => {
        response += `📅 ${projet.date}\n`;
        response += `📍 **${projet.title}**\n`;
        response += `📝 ${projet.description}\n\n`;
    });
    return response.trim();
}
function formatHikeResponse(hike) {
    if (!hike) return null;
    const altitude = (hike.metadata && hike.metadata.altitude) || "Non spécifié";
    const description = hike.content || "Pas de description disponible";
    const date = hike.metadata?.date || "Date non spécifiée";
    const location = hike.metadata?.location || "Non spécifié";
    return `
**🏔️ ${hike.title}**
📅 ${date}
⛰️ Altitude : ${altitude}${typeof altitude === 'number' ? 'm' : ''}
📍 ${location}
📝 Description : ${description.replace(/\*\*/g, '')}
`;
}
function formatHikeResponseWithLineBreaks(hike) {
    const formattedHike = formatHikeResponse(hike);
    return formattedHike + "\n";
}
function findHikesByKeyword(data, keyword) {
    if (!data || !data.pages || !keyword) return [];
    const normalizedKeyword = keyword.toLowerCase();
    return data.pages.filter(page => {
        if (normalizedKeyword.split(' ').length > 1) {
            return page.title?.toLowerCase().includes(normalizedKeyword) || page.content?.toLowerCase().includes(normalizedKeyword);
        } else {
            const title = page.title?.toLowerCase() || '';
            const content = page.content?.toLowerCase() || '';
            return title.includes(normalizedKeyword) || content.includes(normalizedKeyword);
        }
    });
}
function findHikesByMonth(data, targetMonth, targetYear) {
    return data.pages.filter(page => {
        if (!page.metadata?.date) return false;
        const [day, monthStr, year] = page.metadata.date.split(' ');
        const month = websiteIndexer.frenchMonthToNumber(monthStr)
        return (parseInt(year) === targetYear && month === targetMonth);
    });
}
// Load data on startup
console.log('📚 Chargement des données indexées...');
websiteIndexer.loadData()
    .then(() => {
        if (websiteIndexer.data && websiteIndexer.data.pages && websiteIndexer.data.pages.length > 0) {
            dataLoaded = true;
            console.log(`✅ Données chargées avec succès: ${websiteIndexer.data.pages.length} pages`);
        } else {
            console.error('❌ Les données chargées sont invalides ou vides');
        }
    })
    .catch(err => {
        console.error('❌ Erreur lors du chargement des données:', err);
    });

// Route for website indexing
// New route for website indexing
app.post('/api/index-website', async (req, res) => {
    try {
        console.log('🌐 Démarrage de l\'indexation...');
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ error: "URL manquante dans le corps de la requête" });
        }
        await websiteIndexer.startCrawling(url);
        websiteIndexer.data.siteStats = await websiteIndexer.aggregateStats(websiteIndexer.data);
        res.json({ success: true, message: 'Indexation terminée avec succès' });
    } catch (error) {
        console.error('❌ Erreur lors de l\'indexation:', error);
        res.status(500).json({ error: 'Erreur lors de l\'indexation' });
    }
});


// Route for chat
app.post('/api/chat', async (req, res) => {
    try {
        if (!dataLoaded) {
            return res.status(503).json({ error: "Les données ne sont pas encore chargées" });
        }

        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: "Message manquant" });
        }
        console.log('📝 Question reçue:', message);
        const patterns = {
            projetPattern: /\b(projets?|futures?|prévues?|quels?\s*sont\s*les\s*projets?)\b/i,
            askingCount: /combien/i,
            sortiePattern: /\b(sorties?|randonn[ée]e?s?)\b/i,
            yearPattern: /\b(202[0-9])\b/,
            monthPattern: /\b(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\b/i,
            time: /quelle\s+heure\s+est[- ]il/i,
            altitudeQuery: /(?:quelles? sont|voici|liste)?\s*(?:les\s+)?(?:sorties|randonnées)\s*(?:à|au dessus de|au-dessus de|à plus de)\s+(\d{1,2}[ ,]?\d{3})\s*m/i,
            altitudeQueryCount: /(combien|nombre)\s*(?:de\s+)?sorties?\s*(?:à|au dessus de|au-dessus de|à plus de)\s+(\d{1,2}[ ,]?\d{3})\s*m/i
        };
        let response = '';

        // Nouvelle gestion de la question "combien de sorties à plus de X mètres"
         const altitudeQueryMatch = message.match(patterns.altitudeQuery);
         const altitudeQueryCountMatch = message.match(patterns.altitudeQueryCount);

        if (altitudeQueryMatch || altitudeQueryCountMatch) {
          const isCountQuery = !!altitudeQueryCountMatch;
          const altitudeMatch = isCountQuery ? altitudeQueryCountMatch : altitudeQueryMatch;
            const minAltitude = parseInt(altitudeMatch[altitudeMatch.length-1].replace(/[ ,]/g, ''));
            const searchCriteria = {
                minAltitude: minAltitude,
                features: [] 
            };

            const results = await websiteIndexer.searchHikes(searchCriteria);

            if (results.length > 0) {
                const count = results.length;
                 if (isCountQuery){
                    response = `Il y a ${count} sortie${count > 1 ? 's' : ''} à plus de ${minAltitude}m.`;
                 }else{
                    response = `🏔️ Sorties à plus de ${minAltitude}m :\n\n` +
                        results.map(hike =>
                           `**${hike.title}**\n` +
                            `📅 ${hike.metadata.date || 'Date non spécifiée'}\n` +
                            `⛰️ Altitude : ${hike.metadata.altitude || 'Non spécifiée'}m\n` +
                            `📍 ${hike.metadata.location || ''}\n` +
                            `📝 Description : ${hike.content || "Pas de description disponible"}\n\n`
                        ).join('');
                  }
            } else {
                response = `Aucune sortie trouvée au-dessus de ${minAltitude}m.`;
            }
        }

         //gestion de la question "projets"
        else if (patterns.projetPattern.test(message)) {
            const searchResults = await websiteIndexer.searchContent(message, websiteIndexer.data);
    
            if (searchResults?.length > 0 && searchResults[0].isProject) {
                response = searchResults[0].content; 
                if (patterns.askingCount.test(message)) {
                    const count = (searchResults[0].content.match(/📋 Il y a actuellement (\d+) projets/))?.[1] || 0;
                    response = `Il y a ${count} projets prévus pour 2025.`;
                }
                } else {
                response = "Je n'ai pas trouvé de projets.";
            }   

        } else if (patterns.sortiePattern.test(message) && patterns.yearPattern.test(message) && patterns.monthPattern.test(message)) {
            const monthMatch = message.match(patterns.monthPattern);
            const yearMatch = message.match(patterns.yearPattern);
            const year = parseInt(yearMatch[1]);
            const month = websiteIndexer.frenchMonthToNumber(monthMatch[1]);
            if (patterns.askingCount.test(message)) {
                 const count = websiteIndexer.data.siteStats.outingsByMonth[year]?.[month] || 0;
                 response = `Il y a ${count} sortie${count > 1 ? 's' : ''} en ${monthMatch[0]} ${year}.`;
            } else {
                const sorties = findHikesByMonth(websiteIndexer.data, month, year);
                response = sorties.length > 0 ? `Voici les sorties pour ${monthMatch[0]} ${year} :\n\n` + sorties.map(formatHikeResponseWithLineBreaks).join('') : `Aucune sortie trouvée pour ${monthMatch[0]} ${year}.`;
            }
         } else if (patterns.time.test(message)) {
            const now = new Date();
            const hours = now.getHours();
            const minutes = now.getMinutes();
            response =  `Il est ${hours}h${minutes < 10 ? '0' + minutes : minutes}.`
        }else { // Default
              const searchResults = await websiteIndexer.searchContent(message, websiteIndexer.data);
             if (searchResults && searchResults.length > 0 && !searchResults[0].isProject) {
                 response = searchResults[0].content;
             }else{
                   const keywords = [...message.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*|[a-z]{3,}(?:\s+[a-z]{3,})*)\b/g)].map(match => match[0]);
                    const allKeywords = [...new Set([...keywords])];
                    console.log(`🔍 Recherche par mots-clés:`, allKeywords);
                      let sorties = [];
                    if (allKeywords.filter(kw => kw.split(' ').length > 1).length > 0) {
                        for (const keyword of allKeywords) {
                               const results = findHikesByKeyword(websiteIndexer.data, keyword.trim());
                               sorties = [...new Set([...sorties, ...results])];
                           }
                    }else  {
                        const results = findHikesByKeyword(websiteIndexer.data, message.trim())
                        sorties = [...new Set([...sorties, ...results])];
                     }
                     if (sorties.length > 0) {
                            response = `Voici les sorties correspondant à votre recherche :\n\n` + sorties.map(formatHikeResponseWithLineBreaks).join('');
                     }else{
                        const cohereResponse = await cohere.generate({
                            model: 'command',
                            prompt: `Tu es un assistant francophone spécialisé dans la randonnée. Instructions IMPORTANTES :
                            1. Tu DOIS TOUJOURS répondre UNIQUEMENT en français
                            2. Utilise un langage naturel et chaleureux
                            3. Si la question concerne une randonnée ou un lieu, donne des informations pertinentes

                            Question: ${message}

                            Rappel: Ta réponse doit être EXCLUSIVEMENT en français.`,
                            max_tokens: 500,
                            temperature: 0.7,
                        });
                         response = cohereResponse.generations[0].text.trim();
                      }
                }
          }
        previousMessages.push({ role: 'user', content: message });
        previousMessages.push({ role: 'assistant', content: response });

        if (previousMessages.length > 10) {
            previousMessages = previousMessages.slice(-10);
        }

        res.json({ message: response });
    } catch (error) {
        console.error('❌ Erreur lors du traitement du message:', error);
        res.status(500).json({ error: error.message || "Erreur lors du traitement de la demande" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Serveur actif sur http://localhost:${PORT}`);
});
