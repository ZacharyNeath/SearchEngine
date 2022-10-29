const express = require('express');
const pug = require('pug');
const app = express();
const mongo = require('mongodb');
const mongoose = require('mongoose');
const crawler = require("crawler");

const Page = require("./models/PageModel");
const { response } = require('express');

const indexer = require("./indexer");
const { filter } = require('domutils');

const port = 3000;
const url = 'mongodb://localhost:27017/search';
const title = "Peter Parkrawler"
const description = "Insert 60's animated spider-man theme"

app.use(express.static('public'));
app.use(express.urlencoded({extended: true}));
app.use(express.json());

app.set("view engine", "pug");

//GETS home page
app.get('/', (req, res) => {
    res.status(200);
    res.render('index', {title, description});
});

//GETS popular page
app.get('/popular', (req, res) => {
    Page.find((err, pages) => {
        if(err){
			res.status(500).send("Error reading pages.");
			console.log(err);
			return;
		}
        pages.sort(compare);
        let slicedPages = pages.slice(0, 10);

        res.status(200);
        res.render('popular', {title, pages : slicedPages});
    });
});

//GETS search page
app.get('/search', async (req, res) => {
    let page = "search";
    if(req.query.partial){
        page = "results";
    }

    getSearchResults(req, res, page, "search");
});

app.get("/fruits", (req, res) => {
    let page = "results";
    let endpoint = "fruits";

    getSearchResults(req, res, page, endpoint)
});

app.get('/personal', (req, res) => {
    let page = "results";
    let endpoint = "personal";
    
    getSearchResults(req, res, page, endpoint);
});

//GETS home page
app.get('/pages/:pageID', (req, res) => {
    Page.findOne()
    .where("_id").equals(req.params.pageID)
    .exec(function(err, page){
        if(err){
            res.status(500).send(`Error finding page: ${req.params.pageID}`);
            return;
        }
        if(!page){
            res.status(404).send(`Page does not exist ${req.params.pageID}`);
            return;
        }

        //Find relevant page's outgoing and incoming links
        Page.find({url : {$in : page.incomingLinks}}, (err, incomingLinks) => {
            if(err){
                res.status(500).send(`Error finding page: ${req.params.pageID}`);
                return;
            }
            Page.find({url : {$in : page.outgoingLinks}}, (err, outgoingLinks) => {
                if(err){
                    res.status(500).send(`Error finding page: ${req.params.pageID}`);
                    return;
                }
                
                res.status(200);
                res.render('page', {title, page, incomingLinks, outgoingLinks});
            });
        });
    });
});

//HELPER FUNCTIONS
function getSearchResults(req, res, page, endpoint){
    let q = typeof req.query.q === "string" ? req.query.q: "";
    let boost = Boolean(req.query.boost) ? req.query.boost === "true": false;
    let limit = Number(req.query.limit) ? parseInt(req.query.limit): 10;
    
    let criteria = {text : q, fields : {}};

    let results = indexer.search(criteria);

    let filteredResults = results.filter(result => {
        if(endpoint === "fruits"){
            return result.ref.startsWith("https://people.scs.carleton.ca/~davidmckenney/fruitgraph");
        }

        else if(endpoint === "personal"){
            return !result.ref.startsWith("https://people.scs.carleton.ca/~davidmckenney/fruitgraph");
        }

        else{
            return true;
        }
    });

    //filteredResults = filteredResults.splice(0, limit);
    let urls = filteredResults.map((x) => (x.ref));
    
    Page.find({url : {$in : urls}}, (err, pages) => {
        if(err){
            console.log(err.message);
            res.status(400).send(err.message);
            return;
        }
        
        let pageMap = {};
        for(let result of filteredResults){
            pageMap[result.ref] = result.score;
        }
        
        let unsortedResults = [];
        let comparison;
        for(let p of pages){
            if(boost){
                unsortedResults.push({
                    ...p._doc, 
                    score : pageMap[p.url],
                    pageRank : p.pageRank,
                    boostedScore: pageMap[p.url] * p.pageRank
                });
                comparison = compareBoostedScores;
            }
            else{
                unsortedResults.push({
                    ...p._doc,
                    score : pageMap[p.url], 
                    pageRank : p.pageRank,
                });
                comparison = compareScores;
            }
        }
        
        let rankedResults = unsortedResults.sort(comparison);
        rankedResults = rankedResults.slice(0, limit);

        res.status(200);
        res.render(page, {pages : rankedResults});
    });
}

function compare(a, b){
    if ( a.incomingLinks.length > b.incomingLinks.length ){
        return -1;
    }
    if ( a.incomingLinks.length < b.incomingLinks.length ){
        return 1;
    }
    return 0;
}

function compareBoostedScores(a, b){
    if ( a.boostedScore > b.boostedScore ){
        return -1;
    }
    if ( a.boostedScore < b.boostedScore){
        return 1;
    }
    return 0;
}

function compareScores(a, b){
    if ( a.score > b.score ){
        return -1;
    }
    if ( a.score < b.score){
        return 1;
    }
    return 0;
}

//Start server
main().catch(err => console.log(err));

async function main(){
    await mongoose.connect(url);
    await indexer.createIndex();
    app.listen(port, () => {
        console.log(`Server listening at http://localhost:${port}`);
    });
}