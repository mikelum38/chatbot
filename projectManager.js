class ProjectManager {
    constructor(indexer) {
        this.indexer = indexer;
        this.projects = [];
    }

    async loadProjects() {
        try {
            // Chercher la page memories dans les données du site
            const memoriesPage = this.indexer.data.pages.find(page => 
                page.url && page.url.includes('/memories')
            );

            if (!memoriesPage) {
                return "Page memories non trouvée.";
            }

            // Extraire les projets du contenu
            const content = memoriesPage.content;
            const lines = content.split('\n').map(line => line.trim());
            
            const projects = [];
            let currentProject = null;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                
                // Chercher les dates
                if (line.match(/\d{1,2}\s+\w+\s+2025/)) {
                    if (currentProject) {
                        projects.push(currentProject);
                    }
                    currentProject = {
                        date: line.trim(),
                        titre: '',
                        description: ''
                    };
                }
                // Chercher les titres et descriptions
                else if (currentProject && !currentProject.titre && line.length > 0 && !line.includes('function')) {
                    currentProject.titre = line;
                }
                else if (currentProject && currentProject.titre && line.length > 0 && !line.includes('function')) {
                    currentProject.description = line;
                }
            }
            
            // Ajouter le dernier projet
            if (currentProject) {
                projects.push(currentProject);
            }

            this.projects = projects;
            return true;
        } catch (error) {
            console.error('Erreur lors du chargement des projets:', error);
            return false;
        }
    }

    listerProjets() {
        if (this.projects.length === 0) {
            return "Aucun projet n'a été trouvé dans la page memories.";
        }

        let reponse = "📋 Projets de randonnées prévus :\n\n";
        
        this.projects.forEach(projet => {
            reponse += `📅 ${projet.date}\n`;
            reponse += `🎯 ${projet.titre}\n`;
            if (projet.description) {
                reponse += `📝 ${projet.description}\n`;
            }
            reponse += '\n';
        });

        return reponse;
    }

    rechercherProjet(query) {
        const projetsFiltrés = this.projects.filter(projet => 
            projet.titre.toLowerCase().includes(query.toLowerCase()) ||
            (projet.description && projet.description.toLowerCase().includes(query.toLowerCase()))
        );

        if (projetsFiltrés.length === 0) {
            return `Aucun projet ne correspond à votre recherche "${query}".`;
        }

        let reponse = `J'ai trouvé ${projetsFiltrés.length} projet(s) correspondant à votre recherche :\n\n`;
        
        projetsFiltrés.forEach(projet => {
            reponse += `📅 ${projet.date}\n`;
            reponse += `🎯 ${projet.titre}\n`;
            if (projet.description) {
                reponse += `📝 ${projet.description}\n`;
            }
            reponse += '\n';
        });

        return reponse;
    }
}

module.exports = ProjectManager;
