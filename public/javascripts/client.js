function submitSearch(){
    let search = document.getElementById("search").value;

    req = new XMLHttpRequest();
	req.onreadystatechange = function() {
		if(this.readyState==4 && this.status==200){
			pageHTML = req.responseText;
			renderProducts(pageHTML);
		}
	}
					
	req.open("GET", `http://localhost:3000/search?search=${search}&partial=1`);
	req.send();
}

//Clears html of product display
function clearProducts(){
    document.getElementById("mainPagesDisplay").remove();
}

function renderProducts(pageHTML){
    clearProducts();

    let container = document.createElement("div");
    container.id = "mainPagesDisplay";
    container.insertAdjacentHTML('beforeend', pageHTML);

    document.getElementById("pageDisplay").appendChild(container);  
}