const mongoose = require("mongoose");
const { Matrix } = require('ml-matrix');

const Page = require("./models/PageModel");

const url = 'mongodb://localhost:27017/lab3';
const alpha = 0.1;

main();

async function main(){
    await mongoose.connect(url);

    let pages = await Page.find();
    pages.sort(compare);
    let positions = buildPositions(pages);

    let A = Matrix.zeros(pages.length, pages.length);
    setOutgoing(A, pages, positions);
    console.log("Set outgoing");
    console.log(A);
    addMoveProbability(A, pages, positions);
    console.log("Add move prob");
    console.log(A);
    A.mul(1-alpha);
    console.log("Multiply by 1-alpha");
    console.log(A);

    let alphaMatrix = new Matrix(Array(pages.length).fill(Array(pages.length).fill(1/pages.length)));
    console.log("Fill aplha matrix");
    console.log(alphaMatrix);
    alphaMatrix.mul(alpha);
    console.log("Multiply alpha matrix");
    console.log(alphaMatrix);
    
    let result = Matrix.add(A, alphaMatrix);
    console.log("Added two matrices");
    console.log(result);
    let x = powerIteration(result);
    console.log("Power iteration");
    console.log(x);

    let ranks = getTopPageRanks(x, positions);
    displayTopNRanks(ranks, 25);
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

function setOutgoing(ranks, pages, positions){
    for(let i = 0; i < pages.length; i++){
        for(let outgoing of pages[i].outgoingLinks){
            ranks.set(i, positions[outgoing], 1)
        }
    }
}

function addMoveProbability(ranks, pages, positions){
    for(let i = 0; i < pages.length; i++){
        if(pages[i].outgoingLinks.length === 0){
            ranks.setRow(i, Array(pages.length).fill(1/(pages.length)));
            break;
        }
        for(let outgoing of pages[i].outgoingLinks){
            ranks.set(i, positions[outgoing], (ranks.get(i, positions[outgoing])/pages[i].outgoingLinks.length))
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