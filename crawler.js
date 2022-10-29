const Crawler = require("crawler");
const mongo = require('mongodb');
const mongoose = require('mongoose');

const Page = require("./models/PageModel");
const ranker = require("./ranker");
let queued = {};

const LIMIT = 1000;
let count = 0;

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
            delete queued[currentPage];
            done();
            return;
        }
        if(!res.headers["content-type"].includes("text/html")){
            console.log(res.headers["content-type"]);
            console.log(`URL: ${currentPage} \nDoes not return html \n\n`);
            delete queued[currentPage];
            done();
            return;
        }

        let $ = res.$; //get cheerio data, see cheerio docs for info

        //console.log("Title: " + $("title").text());
        //console.log(currentPage);
        
        //Main sequence
        let links = getReferences($);
        let validLinks = validateLinks(links, currentPage, currentDomain);
        logPage($, validLinks, currentPage);
        validLinks = await filter(validLinks);
        validLinks = registerLinks(validLinks);
        
        c.queue(validLinks);

        //console.log("\n\n");

        done();
    }
});

function getCurrentDomain(currentPage){
    let splitLink = currentPage.split("/").slice(0,3);
    return splitLink.join("/");
}

function logPage($, links, currentPage){
    let l = [];
    
    $("a").each(function(i, link){
        l.push($(link).text())
    });

    let p = $("p").text()

    l = l.join(" ");
    let html = {
        title : $("title").text(),
        description : $("meta[name=Description]").attr("content"),
        keywords : $("meta[name=Keywords]").attr("content"),
        paragraphs : p,
        links : l
    };

    let visited = new Date();

    let page = new Page({url : currentPage, html, visited, outgoingLinks : links, incomingLinks : []});
    page.save((err, result) => {
        if(err) throw err;
        delete queued[result.url];
    });
}

function getReferences($){
    let tempLinks = [];
    let links = $("a");

    $(links).each(function(i, link){
        tempLinks.push($(link).attr('href'));
    });

    return tempLinks;
}

function validateLinks(links, currentPage, currentDomain){
    let validLinks = [];

    links = [... new Set(links)];

    for(let link of links){
        if(link && pathType(link) !== "#" && pathType(link) !== "mailto" && pathType(link) !== ":"){
            validLinks.push(buildProperPageLink(link, currentPage, currentDomain));
        }
    }

    validLinks = [... new Set(validLinks)];

    return validLinks;
}

function pathType(ref){
    //
    if(ref.split(".")[0] === ""){
        return ".";
    }
    else if(ref.split("/")[0] === ""){
        return "/";
    }
    else if(ref.split("#")[0] === ""){
        return "#";
    }
    else if(ref.split(":")[0] === "javascript"){
        return ":";
    }
    else if(ref.split("mailto")[0] !== ""){
        return "mail";
    }
    return undefined;
}

function registerLinks(links){
    let i = 0;

    for(let link of links){
        if(count >= LIMIT){
            break;
        }
        queued[link] = 1;
        count++;
        i++
    }

    return links.slice(0, i);
}

async function filter(links){
    let results = await Page.find({url : {$in : links}});

    let validLinks = [];
    let removeIndexes = {};

    for(let page of results){
        if(links.indexOf(page.url) >= 0){
            removeIndexes[links.indexOf(page.url)] = 1;
        }
    }
    
    for(let i in links){
        if((links[i] in queued) && !(removeIndexes[i])){
            removeIndexes[i] = 1;  
        }
    }

    for(let i = 0; i < links.length; i++){
        if(!removeIndexes[i]){
            validLinks.push(links[i]);
        }
    }

    return validLinks;
}

async function logIncoming(){
    let pages = await Page.find();

    let pageMap = {};
    for(let page of pages){
        pageMap[page.url] = page;
    }

    for(let page of pages){
        for(let link of page.outgoingLinks){
            if(pageMap[link]){
                pageMap[link].incomingLinks.push(page.url);
            }
        }
    }
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

function buildProperPageLink(link, currentPage, currentDomain){
    let type = pathType(link);
    if(type === "."){
        let splitLink = currentPage.split("/");
        splitLink.pop();
        splitLink.push(link.split("/")[1]);
        return (splitLink.join("/"));
    }
    else if(type === "/"){
        return (currentDomain + link);
    }
    else if(link){
        return link;
    } 
}

//Perhaps a useful event
//Triggered when the queue becomes empty
//There are some other events, check crawler docs
c.on('drain', async function(){
    console.log("Logging now");
    await logIncoming();
    console.log("Done Logging");
    console.log("Ranking");
    await ranker.rankPages();
    console.log("Done Ranking");
    console.log(count);
    console.log("Done.");
});

mongoose.connect('mongodb://localhost:27017/search', {useNewUrlParser: true});
let db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function() {
	mongoose.connection.db.dropDatabase(function(err, result){
		if(err){
			console.log("Error dropping database:");
			console.log(err);
			return;
		}

        let currentPage = 'https://people.scs.carleton.ca/~davidmckenney/fruitgraph/N-0.html';
        queued[currentPage] = 1;
        count++;

		console.log("Dropped database. Starting crawl.");

        //Queue a URL, which starts the crawl
        c.queue(currentPage);
        //c.queue("https://en.wikipedia.org/wiki/Scythe_(board_game)");
	});
});

//"https://people.scs.carleton.ca/~davidmckenney/fruitgraph/N-0.html"
//c.queue('https://people.scs.carleton.ca/~davidmckenney/tinyfruits/N-0.html');
//c.queue('https://www.miniclip.com/games');
//c.queue("https://www.w3schools.com/jquery/jquery_selectors.asp");