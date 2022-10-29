const mongoose = require("mongoose");
const { Matrix } = require('ml-matrix');

const Page = require("./models/PageModel");

const url = 'mongodb://localhost:27017/search';
const alpha = 0.1;

module.exports = {
    rankPages
}

//main();

async function main(){
    let results = rankPages();
    let ranks = getTopPageRanks(results.ranks, results.positions);
    displayTopNRanks(ranks, 25);
    console.log("Done ranking");
}

async function rankPages(){
    await mongoose.connect(url);

    let pages = await Page.find();
    pages.sort(compare);
    let positions = buildPositions(pages);
    cleanOutgoingLinks(pages, positions);

    let A = Matrix.zeros(pages.length, pages.length);
    setOutgoing(A, pages, positions);
    addMoveProbability(A, pages, positions);
    A.mul(1-alpha);

    let alphaMatrix = new Matrix(Array(pages.length).fill(Array(pages.length).fill(1/pages.length)));
    alphaMatrix.mul(alpha);
    
    let result = Matrix.add(A, alphaMatrix);
    let x = powerIteration(result);

    pages = await Page.find();
    await updatePageRanks(pages, x, positions);
    return {ranks : x, positions};
}

function buildPositions(pages){
    let positions = {};

    let i = 0;
    for(let page of pages){
        positions[page.url] = i;
        ++i;
    }

    return positions;
}

function cleanOutgoingLinks(pages, positions){
    for(let page of pages){
        let validLinks = [];

        for(let outgoing of page.outgoingLinks){
            if(positions[outgoing] !== undefined){
                validLinks.push(outgoing);
            }
            else{
                let x;
            }
        }

        page.outgoingLinks = validLinks;
    }
}

function setOutgoing(ranks, pages, positions){
    for(let i = 0; i < pages.length; i++){
        for(let outgoing of pages[i].outgoingLinks){
            ranks.set(positions[pages[i].url], positions[outgoing], 1)
        }
    }
}

function addMoveProbability(ranks, pages, positions){
    for(let i = 0; i < pages.length; i++){
        if(pages[i].outgoingLinks.length === 0){
            ranks.setRow(positions[pages[i].url], Array(pages.length).fill(1/(pages.length)));
            continue;
        }
        for(let outgoing of pages[i].outgoingLinks){
            ranks.set(positions[pages[i].url], positions[outgoing], (ranks.get(i, positions[outgoing])/pages[i].outgoingLinks.length))
        }
    }
}

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

function euclideanDistance(a, b){
    let n = a.columns;
    let sum = 0;

    for(let i = 0; i < n; i++){
        sum += Math.pow((b.get(0, i) - a.get(0, i)), 2);
    }

    sum = Math.sqrt(sum);

    return sum;
}

function getTopPageRanks(ranks, positions){
    let results = [];

    for(let url in positions){
        results.push({url, rank : ranks.get(0, positions[url])});
    }
    results.sort(compareRanks);

    return results;
}

function displayTopNRanks(ranks, n){
    for(let i = 0; i < n; i++){
        console.log(`#${i+1}. (${ranks[i].rank}) ${ranks[i].url}`);
    }
}

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

function compare(a, b){
    if ( a.url < b.url ){
        return -1;
    }
    if ( a.url > b.url ){
        return 1;
    }
    return 0;
}

function compareRanks(a, b){
    if ( a.rank > b.rank ){
        return -1;
    }
    if ( a.rank < b.rank ){
        return 1;
    }
    return 0;
}