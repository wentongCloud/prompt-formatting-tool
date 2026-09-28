// MV3 service worker：点击工具栏图标时，在新标签页打开工具页面
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: new URL('index.html', self.location.href).href });
});
