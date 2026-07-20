(() => {
  const body = document.body;
  const VACANCY = body.dataset.vacancy || "";
  const PAGE_NAME = body.dataset.page || "careers";
  const COOLDOWN_KEY = body.dataset.cooldown || "dmnd_careers_last_submit";
  const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyKNU1kEZqmxzyhymjcyEqii_B6Q_knWxETezD6gYNKJiHG1MiIeTV9pCe0pgLovMuH/exec";
  const form = document.querySelector(".form-card");
  const note = document.getElementById("form-note");
  const startedAt = document.getElementById("form_started_at");
  const clientScore = document.getElementById("client_score");
  const applyButton = document.getElementById("vacancy-apply-button");
  let formStarted = Date.now();
  const signals = { focus:false, pointer:false, keyboard:false };
  startedAt.value = String(formStarted);

  const setNote = (text,type="") => {
    note.textContent = text;
    note.className = "form-note" + (type ? ` ${type}` : "");
  };
  const normalizeTelegram = value => {
    const clean = value.trim().replace(/^@+/, "");
    return clean ? `@${clean}` : "";
  };
  const validTelegram = value => /^@?[A-Za-z0-9_]{5,32}$/.test(value.trim());
  const tracking = () => {
    const p = new URLSearchParams(location.search);
    return {utm_source:p.get("utm_source")||"",utm_medium:p.get("utm_medium")||"",utm_campaign:p.get("utm_campaign")||"",utm_content:p.get("utm_content")||"",utm_term:p.get("utm_term")||""};
  };
  const scoreClient = () => {
    const elapsed = Date.now() - formStarted;
    let score = 0;
    if(elapsed>1200)score++;
    if(elapsed>5000)score++;
    if(signals.focus)score++;
    if(signals.pointer)score++;
    if(signals.keyboard)score++;
    if(!navigator.webdriver)score++;
    clientScore.value=String(score);
    return {score,elapsed};
  };
  const sendLead = payload => fetch(GOOGLE_SCRIPT_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(payload)});

  applyButton?.addEventListener("click",()=>{
    document.getElementById("apply").scrollIntoView({behavior:"smooth",block:"start"});
    setTimeout(()=>document.getElementById("telegram").focus({preventScroll:true}),450);
  });
  document.addEventListener("focusin",()=>signals.focus=true,{once:true});
  document.addEventListener("pointerdown",()=>signals.pointer=true,{once:true});
  document.addEventListener("keydown",()=>signals.keyboard=true,{once:true});

  form.addEventListener("submit",async event=>{
    event.preventDefault();
    const data=new FormData(form);
    const telegram=normalizeTelegram(String(data.get("telegram")||""));
    const experience=String(data.get("experience")||"").trim();
    const profit=String(data.get("profit")||"").trim();
    const honey=String(data.get("company_website")||"").trim();
    const fraud=scoreClient();
    const lastSubmit=Number(localStorage.getItem(COOLDOWN_KEY)||0);
    if(honey)return setNote("Заявку не прийнято. Оновіть сторінку та спробуйте ще раз.","error");
    if(!validTelegram(telegram))return setNote("Вкажіть Telegram username у форматі @username.","error");
    if(experience.length<2)return setNote("Коротко опишіть свій досвід.","error");
    if(!profit)return setNote("Вкажіть свій профіт.","error");
    if(Date.now()-lastSubmit<45000)return setNote("Заявку вже надіслано. Перед повторною відправкою зачекайте кілька секунд.","warn");
    if(fraud.elapsed<900)return setNote("Форма заповнена надто швидко. Перевірте дані та спробуйте ще раз.","error");

    const payload={name:"",telegram,experience,profit,vacancy:VACANCY,details:`Досвід: ${experience}\nПрофіт: ${profit}`,...tracking(),status:"",page:PAGE_NAME,page_url:location.href,referrer:document.referrer||"",submitted_at:new Date().toISOString(),antifraud:{score:fraud.score,elapsed_ms:fraud.elapsed}};
    const button=form.querySelector(".submit-button");
    const original=button.textContent;
    button.disabled=true;button.textContent="Надсилаємо…";setNote("");
    try{await sendLead(payload)}catch(e){button.disabled=false;button.textContent=original;return setNote("Не вдалося надіслати заявку. Спробуйте ще раз.","error")}
    localStorage.setItem(COOLDOWN_KEY,String(Date.now()));
    if(typeof fbq!=="undefined")fbq("track","Lead",{content_name:VACANCY,content_category:"careers"});
    setNote("Дякуємо. Заявку прийнято — HR зв’яжеться з тобою в Telegram.","ok");
    form.reset();button.disabled=false;button.textContent=original;formStarted=Date.now();startedAt.value=String(formStarted);
  });
})();