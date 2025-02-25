require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const WebsiteIndexer = require('./websiteIndexer');
const { CohereClient } = require('cohere-ai');

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
})
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Charger les données au démarrage
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

// Route pour indexer le site
app.post('/api/index', async (req, res) => {
    try {
        console.log('🌐 Démarrage de l\'indexation...');
        await websiteIndexer.startCrawling('https://hiking-gallery.vercel.app');
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

        await websiteIndexer.startCrawling(url);
        res.json({
            success: true,
            pages: websiteIndexer.data.pages.length,
            urls: websiteIndexer.data.pages.map(p => p.url)
        });

    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: error.message });
    }
});

// Route pour le chat
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

        // Rechercher une réponse dans les données indexées
        const searchResults = await websiteIndexer.searchContent(message, websiteIndexer.data);
        
        let response;
        if (!searchResults || searchResults.length === 0 || !searchResults[0] || !searchResults[0].content) {
            console.log('🤖 Aucune randonnée trouvée, utilisation de Cohere...');
            
            // Utiliser Cohere comme fallback
            const cohereResponse = await cohere.generate({
                model: 'command',
                prompt: `Tu es un assistant francophone. Instructions IMPORTANTES à suivre OBLIGATOIREMENT :
                1. Tu DOIS TOUJOURS répondre UNIQUEMENT en français
                2. Tu ne dois JAMAIS utiliser d'autres langues que le français
                3. Utilise un langage naturel et chaleureux
                4. Si on te pose une question sur une personnalité ou un sujet général, réponds de manière informative mais toujours en français
                
                Question de l'utilisateur: ${message}
                
                Rappel: Ta réponse doit être EXCLUSIVEMENT en français.`,
                max_tokens: 500,
                temperature: 0.7,
            });
            
            response = cohereResponse.generations[0].text.trim();
            console.log('🤖 Réponse de Cohere:', response);
        } else {
            response = searchResults[0].content;
            console.log('✅ Réponse des données de randonnée:', response);
        }

        // Mettre à jour l'historique des messages
        previousMessages.push({ role: 'user', content: message });
        previousMessages.push({ role: 'assistant', content: response });
        
        // Garder seulement les 10 derniers messages
        if (previousMessages.length > 10) {
            previousMessages = previousMessages.slice(-10);
        }

        res.json({ message: response });
    } catch (error) {
        console.error('❌ Erreur lors du traitement du message:', error);
        res.status(500).json({ error: error.message || "Erreur lors du traitement de la demande" });
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