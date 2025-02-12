const chatMessages = document.getElementById('chatMessages');
const userInput = document.getElementById('userInput');
const sendButton = document.getElementById('sendButton');
const MAX_HISTORY = 20; // Limite l'historique à 20 messages

// Gestion de l'historique local
function manageConversationStorage() {
    const messages = Array.from(chatMessages.children)
        .filter(el => el.classList.contains('message'))
        .map(el => ({
            text: el.textContent,
            isUser: el.classList.contains('user-message')
        }))
        .slice(-MAX_HISTORY); // Garde seulement les derniers messages

    localStorage.setItem('chatHistory', JSON.stringify(messages));
}

function addMessage(message, isUser = true) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user-message' : 'bot-message'}`;
    messageDiv.textContent = message;
    
    // Animation d'apparition
    messageDiv.style.opacity = 0;
    chatMessages.appendChild(messageDiv);
    setTimeout(() => messageDiv.style.opacity = 1, 50);
    
    chatMessages.scrollTo({
        top: chatMessages.scrollHeight,
        behavior: 'smooth'
    });
}

async function getAIResponse(prompt) {
    try {
        const response = await fetch('/api/chat', { // URL relative pour le déploiement
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: prompt })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Erreur serveur');
        }

        const data = await response.json();
        return data.response;

    } catch (error) {
        console.error('Erreur API:', error);
        return `Erreur: ${error.message}`;
    }
}

function createTypingIndicator() {
    const typing = document.createElement('div');
    typing.className = 'message bot-message typing';
    typing.innerHTML = `
        <div class="dot-flashing"></div>
        <div class="dot-flashing delay-1"></div>
        <div class="dot-flashing delay-2"></div>
    `;
    return typing;
}

async function handleUserMessage() {
    const message = userInput.value.trim();
    if (!message) return;

    // Désactivation des contrôles
    userInput.disabled = true;
    sendButton.disabled = true;

    // Ajout du message utilisateur
    addMessage(message, true);
    userInput.value = '';
    
    // Indicateur de frappe
    const typingIndicator = createTypingIndicator();
    chatMessages.appendChild(typingIndicator);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
        const response = await getAIResponse(message);
        chatMessages.removeChild(typingIndicator);
        addMessage(response, false);
    } catch (error) {
        chatMessages.removeChild(typingIndicator);
        addMessage("⚠️ Problème de connexion au serveur", false);
    } finally {
        // Réactivation des contrôles
        userInput.disabled = false;
        sendButton.disabled = false;
        userInput.focus();
        manageConversationStorage(); // Sauvegarde après chaque interaction
    }
    // Ajouter dans handleUserMessage après la réponse
    if (data.sources) {
    const sourcesDiv = document.createElement('div');
    sourcesDiv.className = 'sources';
    sourcesDiv.innerHTML = `
        <small>Sources : 
            ${data.sources.map(s => `<a href="${s}" target="_blank">${s}</a>`).join(', ')}
        </small>
    `;
    chatMessages.appendChild(sourcesDiv);
    }
}

// Événements
sendButton.addEventListener('click', handleUserMessage);
userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleUserMessage();
    }
});

// Chargement initial
window.addEventListener('DOMContentLoaded', () => {
    try {
        const history = JSON.parse(localStorage.getItem('chatHistory') || '[]');
        history.forEach(msg => addMessage(msg.text, msg.isUser));
    } catch (e) {
        console.error('Erreur de chargement de l\'historique:', e);
    }
});