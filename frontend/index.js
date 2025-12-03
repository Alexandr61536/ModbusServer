function getData() {
    fetch(`/api`)
        .then((response) => {
            return response.json();
        })
        .then((data) => {
            updateUI(data.tags);
        })
        .catch((error) => {
            console.error('Error:', error);
        });
}

function updateUI(tags) {
    const table = document.getElementById('tagsTable');
    table.className = "table";
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    table.innerHTML = '';

    const indexHeader = document.createElement('th');
    indexHeader.textContent = 'Индексы';
    headerRow.appendChild(indexHeader);

    for (let i = 1; i <= 10; i++) {
        const valueHeader = document.createElement('th');
        valueHeader.textContent = `+${i}`;
        headerRow.appendChild(valueHeader);
    }

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    const rowsCount = Math.ceil(tags.length / 10);

    for (let row = 0; row < rowsCount; row++) {
        const tr = document.createElement('tr');
        
        const startIndex = row * 10;
        const endIndex = Math.min(startIndex + 9, tags.length - 1);
        const indexCell = document.createElement('td');
        indexCell.style = "width: 8vw"
        indexCell.textContent = `i[${startIndex}] - i[${endIndex}]`;
        tr.appendChild(indexCell);
        
        for (let col = 0; col < 10; col++) {
            const index = startIndex + col;
            const valueCell = document.createElement('td');
            valueCell.style = "width: 8vw"
            
            if (index < tags.length) {
                valueCell.textContent = tags[index];
            } else {
                valueCell.textContent = '-';
            }
            
            tr.appendChild(valueCell);
        }
        
        tbody.appendChild(tr);
    }

    table.appendChild(tbody);
}

document.addEventListener("DOMContentLoaded", (event) => {
    setInterval(getData, 500)
});