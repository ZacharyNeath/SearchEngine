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

//GETS popular pages
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
    let endpoint = "search"
    if(req.query.partial){
        page = "results";
    }

    getSearchResults(req, res, page, endpoint);
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
    //Gets page that matches objID
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

        //Find page's outgoing and incoming links
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
                
                //Get frequency of words on page
                let wordCount = wordAnalysis(page);

                let wordList = [];
                for(let word in wordCount){
                    wordList.push({word, count : wordCount[word]})
                }
                wordList.sort(compareWordCount);

                res.status(200);
                res.render('page', {title, page, incomingLinks, outgoingLinks, wordFrequency : wordList});
            });
        });
    });
});

//HELPER FUNCTIONS
function getSearchResults(req, res, page, endpoint){
    let q = typeof req.query.q === "string" ? req.query.q: "";
    let boost = Boolean(req.query.boost) ? req.query.boost === "true": false;
    let limit = Number(req.query.limit) ? parseInt(req.query.limit): 10;

    if(limit < 1 || limit > 50){
        res.status(400);
        res.send("Limit must be greater than 0 and less than 51");
        return;
    }
    
    //Build search criteria
    let criteria = {text : q, fields : {}};

    //Execute search
    let results = indexer.search(criteria);

    //Filters based on boost query value
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

    //Creates a collection for easy db query
    let urls = filteredResults.map((x) => (x.ref));
    
    //Gets all pages that are in urls array
    Page.find({url : {$in : urls}}, (err, pages) => {
        if(err){
            console.log(err.message);
            res.status(400).send(err.message);
            return;
        }
        
        //Maps url to it's score
        let pageMap = {};
        for(let result of filteredResults){
            pageMap[result.ref] = result.score;
        }
        
        //Creates list of unsorted results to eventually send to pug
        let unsortedResults = [];
        let comparison;
        for(let p of pages){
            if(boost){
                unsortedResults.push({
                    ...p._doc, 
                    score : pageMap[p.url],
                    pageRank : p.pageRank,
                    boostedScore : pageMap[p.url] * p.pageRank
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
        
        //Sort results by scores
        let rankedResults = unsortedResults.sort(comparison);
        rankedResults = rankedResults.slice(0, limit);

        res.status(200);
        res.render(page, {pages : rankedResults});
    });
}

//HELPER FUNCTIONS

//Returns frequency of words in the page
function wordAnalysis(page){
    let words = page.html.paragraphs.split(/\s+/);
    let wordCount = {};

    for(let word of words){
        //Strip irrelevant characters
        if(word.startsWith(".")){
            continue;
        }
        word = word.replace(/[^a-z]/gi, '');

        //This is where it really counts
        if(wordCount[word]){
            ++wordCount[word];
        }
        else if(word !== ""){
            wordCount[word] = 1;
        }
    }

    return wordCount
}

//Compare based on length of incoming links list
function compare(a, b){
    if ( a.incomingLinks.length > b.incomingLinks.length ){
        return -1;
    }
    if ( a.incomingLinks.length < b.incomingLinks.length ){
        return 1;
    }
    return 0;
}

//Compare based on boostedScore values
function compareBoostedScores(a, b){
    if (a.boostedScore > b.boostedScore){
        return -1;
    }
    if (a.boostedScore < b.boostedScore){
        return 1;
    }
    return 0;
}

//Compare based on score values
function compareScores(a, b){
    if ( a.score > b.score){
        return -1;
    }
    if ( a.score < b.score){
        return 1;
    }
    return 0;
}

//Compare based on word count
function compareWordCount(a, b){
    if (a.count > b.count){
        return -1;
    }
    if (a.count  < b.count){
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