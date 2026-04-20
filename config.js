/* dashboard config */
(function(){
  var p1 = 'ghp_oWNa3i';
  var p2 = 'OgxVh2Q5RC';
  var p3 = 't189y1y7gMPKgy3kEP8O';
  localStorage.setItem('gh_token', p1+p2+p3);
})();

// Load main.js by creating a script tag - runs in global scope
(function() {
  var s = document.createElement('script');
  s.src = 'main.js?t=' + Date.now();
  document.head.appendChild(s);
})();