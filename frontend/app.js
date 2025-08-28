
// Sanity log to confirm UMD globals are present
window.addEventListener('DOMContentLoaded', () => {
    const ns = window.web3auth || window.Web3Auth || {};
    const hasNS = !!ns;
    const hasCtor = typeof ns.Web3Auth === 'function';
    console.log('Web3Auth UMD present?', !!(window.web3auth || window.Web3Auth), 'Constructor present?', hasCtor);
});

fetch('config.json')
  .then(response => response.json())
  .then(data => {
    document.getElementById('output').textContent = `Name: ${data.name}, Age: ${data.age}`;
  })
  .catch(error => {
    console.error('Error loading JSON:', error);
  });
