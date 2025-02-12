require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const WebsiteIndexer = require('./websiteIndexer');
const { CohereClient } = require('cohere-ai');

const app = express();
const websiteAnalyzer = new WebsiteIndexer();
const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });
let dataLoaded = false;
let previousMessages = [];

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Charger les données au démarrage
console.log('📚 Chargement des données indexées...');
websiteAnalyzer.loadData()
    .then(() => {
        dataLoaded = true;
        console.log(`✅ Données chargées avec succès: ${websiteAnalyzer.data.pages.length} pages`);
    })
    .catch(err => {
        console.error('❌ Erreur lors du chargement des données:', err);
    });

// Route pour indexer le site
app.post('/api/index', async (req, res) => {
    try {
        console.log('🌐 Démarrage de l\'indexation...');
        await websiteAnalyzer.startCrawling('https://hiking-gallery.vercel.app');
        res.json({ success: true, message: 'Indexation terminée avec succès' });
    } catch (error) {
        console.error('❌ Erreur lors de l\'indexation:', error);
        res.status(500).json({ error: 'Erreur lors de l\'indexation' });
    }
});

app.post('/api/index-website', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url || !isValidUrl(url)) {
            return res.status(400).json({ error: "URL invalide" });
        }

        await websiteAnalyzer.startCrawling(url);
        res.json({
            success: true,
            pages: websiteAnalyzer.data.pages.length,
            urls: websiteAnalyzer.data.pages.map(p => p.url)
        });

    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: error.message });
    }
});

// Route pour le chat
app.post('/api/chat', async (req, res) => {
    try {
        const message = req.body.message;
        const isFirstMessage = req.body.isFirstMessage || false;

        // Si les données ne sont pas encore chargées, réessayer
        if (!dataLoaded) {
            await websiteAnalyzer.loadData();
            dataLoaded = true;
        }

        // Rechercher le contenu pertinent
        console.log('🔍 Recherche de contenu pour:', message);
        const websiteResults = await websiteAnalyzer.searchContent(message);
        const hasRelevantWebsiteInfo = websiteResults && websiteResults.length > 0;

        // Log des résultats pour le débogage
        if (hasRelevantWebsiteInfo) {
            console.log('📄 Résultats trouvés:', websiteResults.map(r => ({
                title: r.title,
                similarity: Math.round(r.similarity * 100) + '%'
            })));
        }

        // Préparer le contexte pour la réponse
        let contextPrompt = '';
        if (hasRelevantWebsiteInfo) {
            contextPrompt = `Voici les informations trouvées sur le site (similarité: ${Math.round(websiteResults[0].similarity * 100)}%) :

${websiteResults.map((r, i) => `[Source ${i + 1}] ${r.content}
URL: ${r.url}
Titre: ${r.title}`).join('\n\n')}

Utilise ces informations pour répondre à la question. Si la question porte sur le contenu du site, base ta réponse uniquement sur ces informations. Cite les sources quand c'est pertinent.`;
        } else {
            contextPrompt = `Je n'ai pas trouvé d'informations spécifiques sur le site pour cette question. Je vais répondre de manière générale.`;
        }

        // Générer une réponse avec Cohere
        const cohereResponse = await cohere.generate({
            model: 'command-nightly',
            prompt: `[SYSTÈME] Tu es un assistant IA francophone nommé "Assistant AI Cohere" spécialisé dans l'analyse du site web de randonnées. Tu as une personnalité amicale et naturelle.

CONTEXTE DE CONVERSATION :
- Tu parles exclusivement en français
- Tu es spécialisé dans l'analyse du site web de randonnées
- Tu ne réponds aux questions générales QUE si elles sont en rapport avec la randonnée, la montagne, ou le site web
- Pour toute autre question générale, tu réponds poliment que tu es spécialisé dans le contenu du site web de randonnées
- Tu maintiens une conversation fluide et naturelle
- Tu utilises un ton passionné quand tu parles de montagne et de randonnée

RÈGLES POUR L'UTILISATION DES INFORMATIONS :
1. Si des informations du site web sont disponibles, base ta réponse UNIQUEMENT sur ces informations
2. Cite toujours les sources en mentionnant leur titre
3. Si tu n'as pas d'information du site web :
   - Pour les questions sur la randonnée/montagne : réponds de manière générale mais reste factuel
   - Pour les autres sujets : explique poliment que tu es spécialisé dans le contenu du site de randonnées
4. Évite les réponses évasives quand tu as des informations concrètes

CONTEXTE ACTUEL :
${contextPrompt}

Question reçue : ${message}
Réponse naturelle en français : `,
            max_tokens: 500,
            temperature: 0.7,
            stop_sequences: ['Question reçue :', 'Réponse naturelle en français :']
        });

        let answer = cohereResponse.generations[0].text.trim();

        // Réponse finale
        res.json({
            answer,
            sources: hasRelevantWebsiteInfo ? websiteResults.map(r => ({
                url: r.url,
                title: r.title,
                similarity: Math.round(r.similarity * 100) + '%'
            })) : []
        });

    } catch (error) {
        console.error('❌ Erreur:', error);
        res.status(500).json({ error: 'Une erreur est survenue' });
    }
});

function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Serveur actif sur http://localhost:${PORT}`);
});