const mongoose = require("mongoose");
const { Matrix } = require('ml-matrix');

const Page = require("./models/PageModel");

const url = 'mongodb://localhost:27017/search';
const alpha = 0.1;

//Export so other classes can rank pages
module.exports = {
    rankPages
}

//main();

//For if you want to run ranking on its own
async function main(){
    await mongoose.connect(url);

    let results = await rankPages();
    let ranks = getTopPageRanks(results.ranks, results.positions);

    displayTopNRanks(ranks, 25);
    console.log("Done ranking");
}

//Performs page ranking algorithm
async function rankPages(){
    let pages = await Page.find();
    pages.sort(compare);

    //Maps pages to position in matrix and removes
    //outgoing links that aren't in db
    let positions = buildPositions(pages);
    cleanOutgoingLinks(pages, positions);

    //Builds adjacency matrix
    let A = Matrix.zeros(pages.length, pages.length);
    setOutgoing(A, pages, positions);
    addMoveProbability(A, pages, positions);
    A.mul(1-alpha);

    //Builds alpha matrix
    let alphaMatrix = new Matrix(Array(pages.length).fill(Array(pages.length).fill(1/pages.length)));
    alphaMatrix.mul(alpha);
    
    //Builds transition matrix
    let result = Matrix.add(A, alphaMatrix);
    let x = powerIteration(result);

    //Need to grab pages again because we updated outgoing links
    //and we only want to save pageRank values
    pages = await Page.find();
    await updatePageRanks(pages, x, positions);

    return {ranks : x, positions};
}

//Builds url-to-index-in-matrix mapping
function buildPositions(pages){
    let positions = {};

    let i = 0;
    for(let page of pages){
        positions[page.url] = i;
        ++i;
    }

    return positions;
}

//Removes a page's outgoing links that don't have an entry in the database
function cleanOutgoingLinks(pages, positions){
    for(let page of pages){
        let validLinks = [];

        for(let outgoing of page.outgoingLinks){
            if(positions[outgoing] !== undefined){
                validLinks.push(outgoing);
            }
        }

        page.outgoingLinks = validLinks;
    }
}

//Builds adjacenty matrix where each value is a 1 or 0
//A 1 indicates a page has an outgoing link to that page
//A 0 indicates it does not
//Assumes the ranks matrix is all 0 already
function setOutgoing(ranks, pages, positions){
    for(let i = 0; i < pages.length; i++){
        for(let outgoing of pages[i].outgoingLinks){
            ranks.set(positions[pages[i].url], positions[outgoing], 1)
        }
    }
}

//Adds probablity of moving from one page to another to matrix ranks
function addMoveProbability(ranks, pages, positions){
    for(let i = 0; i < pages.length; i++){
        //If a page has no outgoing links prob of moving
        //is 1/(num total pages)
        if(pages[i].outgoingLinks.length === 0){
            ranks.setRow(positions[pages[i].url], Array(pages.length).fill(1/(pages.length)));
            continue;
        }
        //If a page has outgoing links set the probability
        //of moving to each page to 1/(this page's num outgoing links)
        for(let outgoing of pages[i].outgoingLinks){
            ranks.set(positions[pages[i].url], positions[outgoing], (ranks.get(i, positions[outgoing])/pages[i].outgoingLinks.length))
        }
    }
}

//Performs power iteration
function powerIteration(P){
    let x0 = Matrix.zeros(1, P.columns);
    x0.set(0, 0, 1);
    let x1 = x0;

    do{
        x0 = x1;
        x1 = x0.mmul(P);
    } while(euclideanDistance(x0, x1) >= 0.0001);

    return x1;
}

//Returns euclidean distance of two vectors
function euclideanDistance(a, b){
    let n = a.columns;
    let sum = 0;

    for(let i = 0; i < n; i++){
        sum += Math.pow((b.get(0, i) - a.get(0, i)), 2);
    }

    sum = Math.sqrt(sum);

    return sum;
}

//Creates sorted array of pageranks from a mapping of ranks
function getTopPageRanks(ranks, positions){
    let results = [];

    for(let url in positions){
        results.push({url, rank : ranks.get(0, positions[url])});
    }
    results.sort(compareRanks);

    return results;
}

//Outputs top n ranks to the console
function displayTopNRanks(ranks, n){
    for(let i = 0; i < n; i++){
        console.log(`#${i+1}. (${ranks[i].rank}) ${ranks[i].url}`);
    }
}

//Updates db with new pageranks
async function updatePageRanks(pages, ranks, positions){
    let promises = [];

    for(let page of pages){
        page.pageRank = ranks.get(0, positions[page.url]);
        try{
            promises.push(page.save());
        }
        catch(err){
            console.log(err.message)
        }
    }

    await Promise.all(promises);
}

//Compares based on url
function compare(a, b){
    if ( a.url < b.url ){
        return -1;
    }
    if ( a.url > b.url ){
        return 1;
    }
    return 0;
}

//Compare based on pagerank
function compareRanks(a, b){
    if ( a.rank > b.rank ){
        return -1;
    }
    if ( a.rank < b.rank ){
        return 1;
    }
    return 0;
}