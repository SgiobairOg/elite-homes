const puppeteer = require('puppeteer')
const io = require('console-read-write')
const fs = require('fs')
const lineReader = require('line-reader');

const LOGIN_URL = 'https://tools.elitedangerous.com/en/factions'
const FDEV_USER = process.env.FDEV_USER;
const FDEV_PASS = process.env.FDEV_PASS;
const COOKIES_fILE_PATH = './reports/cookies.json';

const FORM_DATA = {
    factionName: 'Testbed',
    squadName: 'Testbed',
    description: 'Test description',
};

const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function onLine (line, index) {
    console.log('Processing line %d: %s', index, line);
    sleep(1000);
  }

const saveCookies = async ( page ) => {
    // Save Session Cookies
    const cookiesObject = await page.cookies()
    // Write cookies to temp file to be used in other profile pages
    fs.writeFile(COOKIES_fILE_PATH, JSON.stringify(cookiesObject),
    function(err) { 
    if (err) {
        console.log('The file could not be written.', err)
    }
        console.log('Session has been successfully saved')
    })

    await sleep(500)
}
  

let loggedIn = false;

(async () => {
    const browser = await puppeteer.launch({headless: false});
    const page = await browser.newPage();

    const previousSession = fs.existsSync(COOKIES_fILE_PATH)
    if (previousSession) {
        // If file exist load the cookies
        const cookiesString = fs.readFileSync(COOKIES_fILE_PATH);
        const parsedCookies = JSON.parse(cookiesString);
        if (parsedCookies.length !== 0) {
            for (let cookie of parsedCookies) {
                await page.setCookie(cookie)
                loggedIn = true;
            }
            console.log('Session has been loaded in the browser')
        }
    }

    await sleep(5000);

    await page.goto(LOGIN_URL);

    await sleep(500);

    if(!loggedIn) {

        await page.click('#content > div.widget.alt2.allow-overflow.factions > div > div > button');

        await sleep(5000);

        const formPageTarget = page.target();

        const newTarget = await browser.waitForTarget(target => target.opener() === formPageTarget);
        
        const loginPage = await newTarget.page();

        await sleep(500);

        await loginPage.addScriptTag({
            type: 'text/javascript',
            content: 'console.log("here i am"); window.addEventListener("beforeunload", async () => {debugger(); preventDefault(); console.log("waiting"); await window.puppetSnitch()});'
        })

        await loginPage.exposeFunction('puppetSnitch', () => saveCookies(loginPage))

        await loginPage.type('input#username', FDEV_USER, {delay: 90});
        await loginPage.type('input#password_plain', FDEV_PASS, {delay: 120});
        
    }

    await io.ask('Waiting for user login, press enter key to continue');

    await sleep(500);

    await page.type('input[name="name"]', FORM_DATA.squadName, {delay: 100});
    await page.type('input[name="group"]', FORM_DATA.factionName, {delay: 100});
    await page.type('textarea[name="description"]', FORM_DATA.description, {delay: 100});

    await sleep(100);

    await page.focus('#content > div.widget.alt2.allow-overflow.factions > div > div > div > div.form-row.clearfix > button');
    await page.click('#content > div.widget.alt2.allow-overflow.factions > div > div > div > div.form-row.clearfix > button');

    await io.ask('Waiting for user login, press enter key to continue');

    await page.focus('#content > div.widget.alt2.allow-overflow.factions > div > div > div > div:nth-child(2) > fieldset > label:nth-child(2) > input[type=radio]')
    await page.click('#content > div.widget.alt2.allow-overflow.factions > div > div > div > div:nth-child(2) > fieldset > label:nth-child(2) > input[type=radio]')

    await sleep(20);

    await page.focus('#content > div.widget.alt2.allow-overflow.factions > div > div > div > div:nth-child(4) > fieldset > label:nth-child(3) > input[type=radio]')
    await page.click('#content > div.widget.alt2.allow-overflow.factions > div > div > div > div:nth-child(4) > fieldset > label:nth-child(3) > input[type=radio]')

    await page.focus('#content > div.widget.alt2.allow-overflow.factions > div > div > div > div.form-row.clearfix > button.i_right.btn.btn-primary')
    await page.click('#content > div.widget.alt2.allow-overflow.factions > div > div > div > div.form-row.clearfix > button.i_right.btn.btn-primary')


    lineReader.eachLine('./reports/populated-sysems.csv', async (line, last) => {
        console.log(line);
        await sleep(200);
    })
})();