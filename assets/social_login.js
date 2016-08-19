(function() {
  var receiveMessage;

  document.write("<iframe src='http://eightcig.shopapps.io/social-login/customer/login?origin=" + encodeURIComponent(window.location.host) + "' width='155px' height='290' style='border:none;'></iframe>");

  receiveMessage = function(e) {
    var data, results, return_url;
    data = JSON ? JSON.parse(e.data) : $.parseJSON(e.data);
    if (data.source !== 'social-login') {
      return;
    }
    results = /checkout_url=(.*)($|&)/.exec(window.location.search);
    if (results) {
      return_url = '/cart';
    } else {
      return_url = '/account';
    }
    return window.location.href = return_url;
  };

  window.addEventListener("message", receiveMessage, false);

}).call(this);