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

        // Rechercher une réponse
        const searchResults = await websiteIndexer.searchContent(message, websiteIndexer.data);
        
        if (!searchResults || searchResults.length === 0 || !searchResults[0] || !searchResults[0].content) {
            return res.status(404).json({ error: "Aucune réponse trouvée" });
        }

        const response = searchResults[0].content;
        console.log('✅ Réponse envoyée:', response);

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