// Show/hide sections
function showSection(sectionId) {
  // Hide all sections
  document.querySelectorAll('.section').forEach(section => {
    section.classList.remove('active');
  });

  // Remove active class from all nav items
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
  });

  // Show selected section
  document.getElementById(sectionId).classList.add('active');

  // Add active class to clicked nav item
  event.target.classList.add('active');
}

// Fetch Torn API Data
function fetchTornData() {
  const tornDataDiv = document.getElementById('torn-data');
  tornDataDiv.innerHTML = '<p>Loading...</p>';

  fetch('/api/torn/user')
    .then(response => response.json())
    .then(data => {
      tornDataDiv.innerHTML = '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
    })
    .catch(error => {
      tornDataDiv.innerHTML = '<p style="color: red;">Error fetching data: ' + error.message + '</p>';
    });
}

// Link channels (placeholder)
function linkChannels(guildId) {
  alert('Channel linking for guild ' + guildId + ' coming soon!');
}