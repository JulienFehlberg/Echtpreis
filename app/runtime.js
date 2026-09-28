(function(){
  const config=window.ECHTPREIS_CONFIG||{};
  const capacitor=window.Capacitor||null;
  const isNative=!!(capacitor&&typeof capacitor.isNativePlatform==="function"&&capacitor.isNativePlatform());

  function currentPosition(options){
    return new Promise((resolve,reject)=>{
      if(!navigator.geolocation)return reject(new Error("Geolocation unavailable"));
      navigator.geolocation.getCurrentPosition(resolve,reject,options||{enableHighAccuracy:true,timeout:10000,maximumAge:300000});
    });
  }

  async function openExternal(url){
    const browser=capacitor&&capacitor.Plugins&&capacitor.Plugins.Browser;
    if(isNative&&browser&&browser.open)return browser.open({url});
    window.open(url,"_blank","noopener");
  }

  function storage(){
    return {
      get:key=>localStorage.getItem(key),
      set:(key,value)=>localStorage.setItem(key,value),
      remove:key=>localStorage.removeItem(key)
    };
  }

  window.EchtpreisRuntime=Object.freeze({
    platform:isNative?"native":"web",
    isNative,
    config,
    currentPosition,
    openExternal,
    storage:storage()
  });
})();