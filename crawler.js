const Crawler = require("crawler");
const mongo = require('mongodb');
const mongoose = require('mongoose');

const Page = require("./models/PageModel");
let queued = {};

const LIMIT = 10000;
let count = 0;

const c = new Crawler({
    maxConnections : 10, //use this for parallel, rateLimit for individual
    //rateLimit: 1,

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
        else if(!res.headers["content-type"].includes("text/html")){
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
        validLinks = await select(validLinks);
        registerLinks(validLinks);

        if(count <= LIMIT){
            c.queue(validLinks);
        }

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
    l = l.join(" ");
    let html = {
        title : $("title").text(),
        description : $("meta[name=Description]").attr("content"),
        keywords : $("meta[name=Keywords]").attr("content"),
        body : $("body").text(),
        paragraphs : $("p").text(),
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
        if(link && link.split("#")[0] !== "" && link.split("mailto")[0] !== ""){
            validLinks.push(buildProperPageLink(link, currentPage, currentDomain));
        }
    }

    validLinks = [... new Set(validLinks)];

    return validLinks;
}

function pathType(ref){
    if(ref.split(".")[0] === ""){
        return ".";
    }
    else if(ref.split("/")[0] === ""){
        return "/";
    }
    else if(ref.split("#")[0] === ""){
        return "#";
    }
    return undefined;
}

function registerLinks(links){
    if(count >= LIMIT){
        return;
    }
    for(let link of links){
        queued[link] = 1;
        count++;
    }
}

async function select(links){
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

function logIncoming(){
    Page.find({}, (err, pages) => {
        if(err) throw err;

        let pageMap = {};
        for(let page of pages){
            pageMap[page.url] = page;
        }

        for(let page of pages){
            for(let link of page.outgoingLinks){
                if(pageMap[link]){
                    if(!pageMap[link].incomingLinks){
                        console.log("What");
                    }
                    pageMap[link].incomingLinks.push(page.url);
                }
            }
        }

        for(const key of Object.keys(pageMap)){
            try{
                pageMap[key].save();
            }
            catch(err){
                console.log(err.message);
            }
        }
    });
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
c.on('drain',function(){
    logIncoming();
    console.log(count);
    console.log("Done.");
});

mongoose.connect('mongodb://localhost:27017/lab3', {useNewUrlParser: true});
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
	});
});

//"https://people.scs.carleton.ca/~davidmckenney/fruitgraph/N-0.html"
//c.queue('https://people.scs.carleton.ca/~davidmckenney/tinyfruits/N-0.html');
//c.queue('https://www.miniclip.com/games');
//c.queue("https://www.w3schools.com/jquery/jquery_selectors.asp");