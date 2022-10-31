//Submits search query to server
function submitSearch(){
    //Gets all query params
    let q = document.getElementById("search").value;
    let boost = document.getElementById("boost").checked;
    let limit = document.getElementById("limit").value;
    let searchType = document.getElementById("pageType").value;
    let search = searchType === "any" ? "search" : searchType;

    //Performs error checking
    if (!isSearchValid()) return;

    req = new XMLHttpRequest();
	req.onreadystatechange = function() {
		if(this.readyState==4 && this.status==200){
			pageHTML = req.responseText;
			renderResults(pageHTML);
		}
        else if(this.readyState==4 && this.status==400){
            alert(req.responseText);
        }
	}
					
	req.open("GET", `http://localhost:3000/${search}?q=${q}&boost=${boost}&limit=${limit}&partial=1`);
	req.send();
}

//Clears html of product display
function clearResults(){
    document.getElementById("mainPagesDisplay").remove();
}

//Renders new results
function renderResults(pageHTML){
    clearResults();

    let container = document.createElement("div");
    container.id = "mainPagesDisplay";
    container.insertAdjacentHTML('beforeend', pageHTML);

    document.getElementById("pageDisplay").appendChild(container);  
}

//Checks if user input is valid
function isSearchValid() {
    const limit = document.getElementById("limit").value;
    const isLimitValid = limit>0 && limit <= 50;
    
    if (!isLimitValid) {
        alert("Limit is invalid");
    }

    return isLimitValid;
}
