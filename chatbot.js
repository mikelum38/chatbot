const config = require('./config');

class Chatbot {
    constructor() {
        this.name = "Mike";
        this.responses = {
            greeting: (userName) => `Bonjour ${userName}, je m'appelle ${this.name}. Je suis là pour vous aider avec vos questions sur les randonnées.`,
            nameConfirmation: () => `Oui, je m'appelle ${this.name}. N'hésitez pas si vous avez des questions !`,
            help: () => "Je peux vous aider avec des informations sur les randonnées, les sommets, les lacs et les glaciers. Que souhaitez-vous savoir ?",
            default: () => "Je ne suis pas sûr de comprendre. Pourriez-vous reformuler votre question ?",
            farewell: () => "Au revoir ! J'espère avoir pu vous aider. À bientôt !",
        };
    }

    generateResponse(message, context = {}) {
        message = message.toLowerCase();
        
        // Détection des salutations
        if (message.includes('bonjour') || message.includes('salut')) {
            return this.responses.greeting(context.userName || 'cher visiteur');
        }
        
        // Confirmation du nom
        if (message.includes("tu t'appelles") && message.includes('mike')) {
            return this.responses.nameConfirmation();
        }
        
        // Demande d'aide
        if (message.includes('aide') || message.includes('help')) {
            return this.responses.help();
        }
        
        // Au revoir
        if (message.includes('au revoir') || message.includes('bye')) {
            return this.responses.farewell();
        }
        
        // Réponse par défaut
        return this.responses.default();
    }
}

module.exports = new Chatbot();
