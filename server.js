const express = require('express');
const pug = require('pug');
const app = express();
const mongo = require('mongodb');
const mongoose = require('mongoose');
const crawler = require("crawler");

const Page = require("./models/PageModel");
const { response } = require('express');

const indexer = require("./indexer");

const port = 3000;
const url = 'mongodb://localhost:27017/lab3';
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
app.get('/search', (req, res) => {
    let page = "search";
    if(req.query.partial){
        page = "pages-partial";
    }

    let criteria = {text : req.query.search, fields : {}};
    let results = indexer.search(criteria, {body: {boost : 2}});

    let message = results.length <= 0 ? "Sorry nothing matched your search criteria" : ""; 
    
    let betterUrls = results.splice(0,10);
    let urls = betterUrls.map((x) => (x.ref));

    Page.find({url : {$in : urls}}, (err, pages) => {
        if(err){
            console.log(err.message);
            res.status(400).send(err.message);
            return;
        }

        let orderedResults = [];
        for(let url of betterUrls){
            for(let page of pages){
                if(url.ref === page.url){
                    page.score = url.score;
                    orderedResults.push(page);
                    break;
                }
            }
        }

        res.status(200);
        res.render(page, {pages : orderedResults, message});
    });
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

        Page.find({url : {$in : page.incomingLinks}}, (err, links) => {
            if(err){
                res.status(500).send(`Error finding page: ${req.params.pageID}`);
                return;
            }
            res.status(200);
            res.render('page', {title, page, incomingLinks : links});
        });
    });
});

//HELPER FUNCTIONS
function compare(a, b){
    if ( a.incomingLinks.length > b.incomingLinks.length ){
        return -1;
    }
    if ( a.incomingLinks.length < b.incomingLinks.length ){
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