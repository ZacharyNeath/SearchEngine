const Crawler = require("crawler");
const { SingularValueDecomposition } = require("ml-matrix");
const mongo = require('mongodb');
const mongoose = require('mongoose');
const prompt = require('prompt-sync')();

const BATCH_LIMIT = 2000;
const Page = require("./models/PageModel");
const ranker = require("./ranker");
let databaseResults = {};
let currentBatch = {};
let visited = [];
let futurePagesMap = {};
let futureBatchPages = [];
let done = false;
let first = true;
let batchCount = 0;
let visitedCount = 0;

const c = new Crawler({
    maxConnections : 10, //use this for parallel, rateLimit for individual
    //rateLimit: 1,
    retries: 1,
    retryTimeout: 1000,
    
    // This will be called for each crawled page
    callback : async function (error, res, done) {
        if(error){
            console.log(error);
            done();
        }

        let currentPage = res.options.uri;
        let currentDomain = getCurrentDomain(currentPage);

        //Check if response is html
        if(!res.headers["content-type"]){
            console.log(`URL: ${currentPage} \nDoes not return html \n\n`);
            delete currentBatch[currentPage];
            done();
            return;
        }
        if(!res.headers["content-type"].includes("text/html")){
            console.log(res.headers["content-type"]);
            console.log(`URL: ${currentPage} \nDoes not return html \n\n`);
            delete currentBatch[currentPage];
            done();
            return;
        }

        let $ = res.$; //get cheerio data, see cheerio docs for info
        
        //Main sequence
        let links = getLinks($);
        let validLinks = validateLinks(links, currentPage, currentDomain);
        logPage($, validLinks, currentPage);
        validLinks = await removeAlreadyDiscoveredLinks(validLinks);
        validLinks = registerLinks(validLinks);
        
        c.queue(validLinks);

        done();
    }
});

//Get the current domain
//e.g. www.Library.com is a domain and
//www.Library.com/books is a specific resource or page
//within that domain 
function getCurrentDomain(currentPage){
    let splitLink = currentPage.split("/").slice(0,3);
    return splitLink.join("/");
}

//Gets all of a pages information
//and logs it as visited
function logPage($, links, currentPage){
    let v = new Date();
    let p = $("p").text()

    //Gets link text from page
    let l = [];
    $("a").each(function(i, link){
        l.push($(link).text())
    });
    l = l.join("\n");

    //Gets all other relevant html
    let html = {
        title : $("title").text(),
        description : $("meta[name=Description]").attr("content"),
        keywords : $("meta[name=Keywords]").attr("content"),
        paragraphs : p,
        links : l,
    };

    visitedCount++;
    //console.log(visitedCount);
    let page = new Page({url : currentPage, html, visited : v, outgoingLinks : links, incomingLinks : []});
    visited.push(page);
}

//Gets all a pages links
function getLinks($){
    let tempLinks = [];
    let links = $("a");

    $(links).each(function(i, link){
        tempLinks.push($(link).attr('href'));
    });

    return tempLinks;
}

//Removes duplicate links, and links that are not urls
function validateLinks(links, currentPage, currentDomain){
    let validLinks = [];

    //Remove duplicates
    links = [... new Set(links)];

    for(let link of links){
        //Only pushes links that are urls
        if(link && pathType(link) !== "#" && pathType(link) !== "mailto" && pathType(link) !== ":"){
            validLinks.push(buildProperPageLink(link, currentPage, currentDomain));
        }
    }

    //Remove duplicates
    validLinks = [... new Set(validLinks)];

    return validLinks;
}

//Identifies pathtype by looking
//at the start of the path
function pathType(ref){
    if(ref.split(".")[0] === ""){ //Link goes up a level in pathway
        return ".";
    }
    else if(ref.split("/")[0] === ""){ //Relative path
        return "/";
    }
    else if(ref.split("#")[0] === ""){ //HTML id link
        return "#";
    }
    else if(ref.split(":")[0] === "javascript"){ //JS link
        return ":";
    }
    else if(ref.split("mailto")[0] !== ""){ //Email link
        return "mail";
    }
    else{
        return undefined;
    }
}

//Adds given links to the current batch 
//list or the upcoming batch list
//Returns all links that get registered 
//to the current batch
function registerLinks(links){
    let i = 0;

    for(let link of links){
        if(batchCount >= BATCH_LIMIT){
            //Add to upcoming batches
            futureBatchPages.push(link);
            futurePagesMap[link] = 1;
        }
        else{
            //Add to current batch
            currentBatch[link] = 1;
            batchCount++;
            i++
        }
    }

    return links.slice(0, i);
}

//Removes links already in the database, in the
//current batch, or already queued for a future batch
async function removeAlreadyDiscoveredLinks(links){
    let validLinks = [];
    let removeIndexes = {};

    //Remove any already in the database
    for(let i in links){
        if(links[i] in databaseResults){
            removeIndexes[i] = 1; 
        }
    }
    
    //Remove any already in the current batch
    for(let i in links){
        if(links[i] in currentBatch){
            removeIndexes[i] = 1;  
        }
    }

    //Remove any that is already in upcoming
    for(let i in links){
        if(links[i] in futurePagesMap){
            removeIndexes[i] = 1;  
        }
    }

    //Creates the list of valid links
    //by adding any link that doesn't appear in removeIndexes
    for(let i = 0; i < links.length; i++){
        if(!removeIndexes[i]){
            validLinks.push(links[i]);
        }
    }

    return validLinks;
}

//Updates pages in the database to
//include their incoming links
async function logIncoming(){
    let pages = await Page.find();

    //Maps page url to page object for fast retrieval
    let pageMap = {};
    for(let page of pages){
        pageMap[page.url] = page;
        page.incomingLinks = [];
    }

    //Goes over each page's outgoing links and
    //adds itself to the incoming links of each outgoing link
    for(let page of pages){
        for(let outgoingLink of page.outgoingLinks){
            //Checks that outgoing exists in the database
            if(pageMap[outgoingLink]){
                pageMap[outgoingLink].incomingLinks.push(page.url);
            }
        }
    }

    //Updates all pages in database
    const promises = [];
    for(const key of Object.keys(pageMap)){
        try{
            const promise = pageMap[key].save();
            promises.push(promise);
        }
        catch(err){
            console.log(err.message);
        }
    }
    await Promise.all(promises);
}

//Builds the actual url needed to visit site
function buildProperPageLink(link, currentPage, currentDomain){
    let type = pathType(link);
    if(type === "."){ //New page is a directory up
        let splitLink = currentPage.split("/");
        splitLink.pop();
        splitLink.push(link.split("/")[1]);
        return (splitLink.join("/"));
    }
    else if(type === "/"){ //Relative link
        return (currentDomain + link);
    }
    else if(link){ //Absolute link
        return link;
    } 
}

//Saves pages from current batch
async function saveCurrentBatch(){
    //Save current batch
    let promises = [];
    for(let page of visited){
        promises.push(page.save());
    }
    await Promise.all(promises);
}

//Resets batch information and sets up new
//batch from future batch info
async function setupNewBatch(){
    //Reset
    databaseResults = {};
    currentBatch = {};
    batchCount = 0;

    //Save current batch
    await saveCurrentBatch();
    visited = [];

    //Get next batch
    let nextBatchSize = (futureBatchPages.length < BATCH_LIMIT) ? futureBatchPages.length : BATCH_LIMIT;
    let nextBatch = futureBatchPages.splice(0, nextBatchSize);
    batchCount = nextBatchSize;
    for(let page of nextBatch){
        delete futurePagesMap[page];
        currentBatch[page] = 1;
    }

    //Get local db
    let pages = await Page.find().select("url").exec();
    for(let page of pages){
        databaseResults[page.url] = 1;
    }

    c.queue(nextBatch);
}

//Triggered when the queue becomes empty
//There are some other events, check crawler docs
c.on('drain', async function(){
    //This is specifically here so we can crawl fruitgraph first and then start other stuff
    if(first){
        console.log("Done fruitgraph");
        first = false;
        let page = "https://en.wikipedia.org/wiki/Scythe_(board_game)";
        currentBatch[page] = 1;
        batchCount++;
        c.queue(page);
        return;
    }
    console.log("Batch is done. Enter q to end crawling. Enter anything else to continue:");
    done = prompt() === "q";

    console.log("Saving last batch");
    await saveCurrentBatch();
    console.log("Saved");
    console.log("Logging now");
    await logIncoming();
    console.log("Done Logging");
    console.log("Ranking");
    await ranker.rankPages();
    console.log("Done Ranking");

    if(done){
        console.log(batchCount);
        console.log("Done.");
    }
    else{
        await setupNewBatch();
    }
});

mongoose.connect('mongodb://localhost:27017/search', {useNewUrlParser: true});
let db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function() {
	mongoose.connection.db.dropDatabase(async function(err, result){
		if(err){
			console.log("Error dropping database:");
			console.log(err);
			return;
		}
        console.log("Dropped database. Starting crawl.");

        //Starts crawl on first link
        let currentPage = 'https://people.scs.carleton.ca/~davidmckenney/fruitgraph/N-0.html';
        futurePagesMap[currentPage] = 1;
        futureBatchPages.push(currentPage);
        await setupNewBatch();
	});
});

//"https://people.scs.carleton.ca/~davidmckenney/fruitgraph/N-0.html"
//c.queue('https://people.scs.carleton.ca/~davidmckenney/tinyfruits/N-0.html');
//c.queue('https://www.miniclip.com/games');
//c.queue("https://www.w3schools.com/jquery/jquery_selectors.asp");