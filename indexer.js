const elasticlunr = require("elasticlunr");
const mongoose = require("mongoose");

const Page = require("./models/PageModel");

const index = elasticlunr(function () {
    this.setRef('url');
    this.addField('title');
    this.addField('body');
    this.addField('links');
});

module.exports = {
    createIndex,
    search
}

async function createIndex(){
    let pages = await Page.find();
    for(let page of pages){
        let doc = {
            url : page.url,
            title : page.html.title,
            body : page.html.paragraphs,
            links : page.html.links,
        }
        index.addDoc(doc);
    }
}

function search(criteria){
    let results = index.search(criteria.text, {...criteria.fields});
    return results;
}