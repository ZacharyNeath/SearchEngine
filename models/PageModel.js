const mongoose = require("mongoose");
const Schema = mongoose.Schema;

let pageSchema = Schema({
	url : { 
        type : String,
        required : true,
        unique : true
    },
    visited : {
        type : Date
    },
    html : {
        type : {
            title : {type : String},
            description : {type: String},
            keywords : {type : [String]},
            paragraphs : {type : String},
            links : {type : String}
        },
        required : true
    },
    incomingLinks : {
        type : [String],
        default : []
    },
    outgoingLinks : {
        type : [String],
        default : []
    },
    pageRank : {
        type : Number,
        default : 0
    }
});

module.exports = mongoose.model("Page", pageSchema);