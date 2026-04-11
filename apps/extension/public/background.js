const GATEWAY_URL = "http://127.0.0.1:4040";

chrome.action.onClicked.addListener(() => {
  chrome.tabs.query({ url: GATEWAY_URL + "/*" }, (tabs) => {
    if (tabs.length) {
      chrome.tabs.update(tabs[0].id, { active: true });
    } else {
      chrome.tabs.create({ url: GATEWAY_URL });
    }
  });
});
