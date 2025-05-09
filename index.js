#!/usr/bin/env node

import { program } from 'commander';
import path from 'path';
import fs from 'fs';
import scrape from 'website-scraper';
import TurndownService from 'turndown';
import { JSDOM } from 'jsdom';
import chalk from 'chalk';
import ExistingDirectoryPlugin from 'website-scraper-existing-directory';

// Configure command line options
program
  .requiredOption('-u, --url <url>', 'URL to crawl')
  .option('-o, --output <directory>', 'Output directory', './docs')
  .option('-d, --delay <ms>', 'Delay between requests in milliseconds', '100')
  .option('-s, --selector <selector>', 'CSS selector for content extraction', 'main')
  .option('--no-domain-restrict', 'Allow crawling external domains')
  .option('-p, --path-pattern <regex>', 'Regex pattern to match allowed paths (e.g., "^/docs/.*")')
  .option('-i, --ignore-selectors <selectors>', 'Comma-separated list of CSS selectors to ignore', 'script,style,iframe,svg,button,.ad,.advertisement,.banner,.cookie-banner,.newsletter-signup')
  .option('--strip-js', 'Strip inline JavaScript from the content', true)
  .parse(process.argv);

const options = program.opts();

// Initialize Turndown service with enhanced options
const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  hr: "---",
  emDelimiter: "*",
  strongDelimiter: "**",
  linkStyle: "inlined",
  linkReferenceStyle: "full",
  // Custom rules for better markdown conversion
  customRules: [
    {
      filter: ["script", "style", "iframe", "svg", "button"],
      replacement: () => "",
    },
  ],
});

// Add ignore selectors from command line
const ignoreSelectors = options.ignoreSelectors.split(',');
ignoreSelectors.forEach(selector => {
  turndownService.addRule(selector, {
    filter: selector,
    replacement: () => ''
  });
});

// Add rule to strip inline JavaScript if enabled
if (options.stripJs) {
  turndownService.addRule('stripInlineJs', {
    filter: (node) => {
      return node.nodeType === 1 && // Element node
        (node.hasAttribute('onclick') ||
         node.hasAttribute('onload') ||
         node.hasAttribute('onmouseover') ||
         node.hasAttribute('onmouseout') ||
         node.hasAttribute('onkeydown') ||
         node.hasAttribute('onkeyup') ||
         node.hasAttribute('onkeypress'));
    },
    replacement: (content, node) => {
      // Remove all event attributes
      const attributes = node.attributes;
      for (let i = attributes.length - 1; i >= 0; i--) {
        const attr = attributes[i];
        if (attr.name.startsWith('on')) {
          node.removeAttribute(attr.name);
        }
      }
      return content;
    }
  });
}

// Validate URL
try {
  new URL(options.url);
} catch (e) {
  console.error(chalk.red('Invalid URL provided'));
  process.exit(1);
}

// Validate path pattern if provided
let pathPattern;
if (options.pathPattern) {
  try {
    pathPattern = new RegExp(options.pathPattern);
  } catch (e) {
    console.error(chalk.red('Invalid path pattern regex provided'));
    process.exit(1);
  }
}

// Create output directory if it doesn't exist
if (!fs.existsSync(options.output)) {
  fs.mkdirSync(options.output, { recursive: true });
}

// Get base domain for restriction
const baseDomain = new URL(options.url).hostname;

// Configure scraper
const scraperOptions = {
  urls: [options.url],
  directory: path.join(options.output, '.crawl'),
  recursive: true,
  maxDepth: 10,
  prettifyUrls: true,
  sources: [
    { selector: 'a', attr: 'href' }
  ],
  request: {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DocumentationCrawler/1.0)'
    }
  },
  urlFilter: (url) => {
    try {
      const urlObj = new URL(url);
      
      // Check domain restriction
      if (options.domainRestrict && urlObj.hostname !== baseDomain) {
        return false;
      }
      
      // Check path pattern if provided
      if (pathPattern && !pathPattern.test(urlObj.pathname)) {
        return false;
      }
      
      return true;
    } catch {
      return false;
    }
  },
  requestDelay: parseInt(options.delay),
  filenameGenerator: 'bySiteStructure',
  plugins: [
    new ExistingDirectoryPlugin()
  ]
};

// Process HTML files
async function processHtmlFile(filePath) {
  try {
    const html = fs.readFileSync(filePath, 'utf8');
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // Extract content using the specified selector
    const content = document.querySelector(options.selector);
    if (!content) {
      console.warn(chalk.yellow(`No content found with selector "${options.selector}" in ${filePath}`));
      return;
    }

    // Remove unwanted elements before conversion
    ignoreSelectors.forEach(selector => {
      const elements = content.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    });

    // Convert to markdown
    const markdown = turndownService.turndown(content.innerHTML);
    
    // Create markdown file path
    const relativePath = path.relative(path.join(options.output, '.crawl'), filePath);
    const markdownPath = path.join(options.output, relativePath.replace('.html', '.md'));
    
    // Ensure directory exists
    fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
    
    // Save markdown file
    fs.writeFileSync(markdownPath, markdown);
    console.log(chalk.green(`Converted ${relativePath} to markdown`));
  } catch (error) {
    console.error(chalk.red(`Error processing ${filePath}:`), error);
  }
}

// Helper function to recursively delete a directory
function deleteDirectory(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.readdirSync(dirPath).forEach((file) => {
      const curPath = path.join(dirPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        deleteDirectory(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(dirPath);
  }
}

// Main execution
async function main() {
  console.log(chalk.blue('Starting documentation crawler...'));
  console.log(chalk.blue(`Target URL: ${options.url}`));
  console.log(chalk.blue(`Output directory: ${options.output}`));
  console.log(chalk.blue(`Content selector: ${options.selector}`));
  console.log(chalk.blue(`Request delay: ${options.delay}ms`));
  console.log(chalk.blue(`Domain restriction: ${options.domainRestrict ? 'enabled' : 'disabled'}`));
  if (options.pathPattern) {
    console.log(chalk.blue(`Path pattern: ${options.pathPattern}`));
  }
  console.log(chalk.blue('Using bySiteStructure filename generator'));
  console.log(chalk.blue('Using existing directory plugin'));

  try {
    // Create output directory if it doesn't exist
    if (!fs.existsSync(options.output)) {
      fs.mkdirSync(options.output, { recursive: true });
    }

    // Start scraping
    await scrape(scraperOptions);
    console.log(chalk.green('Website scraping completed'));

    // Process all HTML files
    const tempDir = path.join(options.output, '.crawl');
    const htmlFiles = getAllFiles(tempDir, '.html');
    
    console.log(chalk.blue(`Found ${htmlFiles.length} HTML files to process`));
    
    for (const file of htmlFiles) {
      await processHtmlFile(file);
    }

    // Clean up temporary directory
    console.log(chalk.blue('Cleaning up temporary files...'));
    deleteDirectory(tempDir);

    console.log(chalk.green('Documentation processing completed successfully!'));
  } catch (error) {
    console.error(chalk.red('Error during crawling:'), error);
    // Clean up temporary directory even if there's an error
    const tempDir = path.join(options.output, '.crawl');
    if (fs.existsSync(tempDir)) {
      deleteDirectory(tempDir);
    }
    process.exit(1);
  }
}

// Helper function to get all files with specific extension
function getAllFiles(dir, ext) {
  let results = [];
  const list = fs.readdirSync(dir);
  
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      results = results.concat(getAllFiles(filePath, ext));
    } else if (file.endsWith(ext)) {
      results.push(filePath);
    }
  });
  
  return results;
}

main();
