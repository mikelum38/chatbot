require('dotenv').config();
const express = require('express');
const cors = require('cors');
const https = require('https');
const path = require('path');

const app = express();

// Configuration initiale
let chatHistory = [];
const MAX_HISTORY = 10;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ajouter pour le routage client
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Vérification de la clé API
if (!process.env.COHERE_API_KEY) {
    console.error('ERREUR: Clé API manquante dans .env');
    process.exit(1);
}

// Détection d'intention
function detectIntent(message) {
    const intents = {
        greeting: ['bonjour', 'salut', 'coucou', 'hello'],
        thanks: ['merci', 'remercie', 'cool', 'super'],
        goodbye: ['au revoir', 'bye', 'à plus']
    };

    const lowerMsg = message.toLowerCase();
    
    for (const [intent, keywords] of Object.entries(intents)) {
        if (keywords.some(word => lowerMsg.includes(word))) {
            return intent;
        }
    }
    return null;
}

// Communication avec Cohere
async function getCohereResponse(message) {
    try {
        // Mise à jour de l'historique
        chatHistory.push({ role: 'USER', message });
        if (chatHistory.length > MAX_HISTORY) chatHistory.shift();

        const data = JSON.stringify({
            message: message,
            chat_history: chatHistory.slice(-MAX_HISTORY),
            model: 'command-r-plus',
            temperature: 0.3,
            max_tokens: 300
        });

        const options = {
            hostname: 'api.cohere.ai',
            path: '/v1/chat',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.COHERE_API_KEY}`,
                'Request-Source': 'nodejs-server'
            }
        };

        const response = await new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let responseData = '';
                
                res.on('data', (chunk) => {
                    responseData += chunk;
                });

                res.on('end', () => {
                    try {
                        const jsonResponse = JSON.parse(responseData);
                        resolve(jsonResponse);
                    } catch (error) {
                        reject(new Error('Erreur de parsing JSON'));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.write(data);
            req.end();
        });

        // Gestion des réponses
        if (response.message) throw new Error(response.message);
        
        const botResponse = response.text || "Désolé, je n'ai pas pu générer de réponse.";
        chatHistory.push({ role: 'CHATBOT', message: botResponse });

        return botResponse;

    } catch (error) {
        console.error('Erreur Cohere:', error);
        throw error;
    }
}

// Endpoint API
app.post('/api/chat', async (req, res) => {
    try {
        if (!req.body.message?.trim()) {
            return res.status(400).json({ error: 'Message vide' });
        }

        const message = req.body.message.trim();
        const intent = detectIntent(message);

        // Réponses prédéfinies
        if (intent) {
            const responses = {
                greeting: ["Bonjour ! Comment puis-je vous aider ?", "Salut ! 😊"],
                thanks: ["Je vous en prie !", "Toujours là pour aider !"],
                goodbye: ["À bientôt !", "Bonne journée !"]
            };
            const response = responses[intent][Math.floor(Math.random() * responses[intent].length)];
            chatHistory.push({ role: 'CHATBOT', message: response });
            return res.json({ response });
        }

        // Réponse IA
        const response = await getCohereResponse(message);
        res.json({ response });

    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ 
            error: error.message.includes('API') 
                ? 'Problème de connexion avec le service AI' 
                : 'Erreur interne du serveur' 
        });
    }
});

// Route de fallback pour le frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Démarrage du serveur
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Serveur actif sur http://localhost:${PORT}`);
});