const WebsiteAnalyzer = require('./websiteIndexer');

async function main() {
    const analyzer = new WebsiteAnalyzer();
    await analyzer.startCrawling('https://hiking-gallery.vercel.app');
}

main().catch(console.error);
