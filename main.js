var discord = require("discord.io");        // Discord API
var logger = require("winston");            // Logging
var auth = require("./auth.json");          // Auth tokens
var axios = require("axios");               // HTTP request library, Promise-based
var jsdom = require("jsdom");               // Node DOM Support
var querystring = require("querystring")

const { JSDOM } = jsdom;

function sanitizeAndFormat(dirty_text) {
    return encodeURIComponent(dirty_text);
}

async function getURLFromQueryText(stubbed_text) {
    // Search the Risk of Rain 2 wiki for the stubbed text, and return the text of the first search result.
    // TODO: Do error checking here
    
    try {
        const doc = await JSDOM.fromURL(
            `https://riskofrain2.fandom.com/wiki/Special:Search?query=${sanitizeAndFormat(stubbed_text)}&scope=internal&navigationSearch=true`
        );

        // Got the response, parse it for the search results
        var element = doc.window.document.querySelector(".unified-search__result__link");

        var url = element.textContent.replace(/\s/g, "");

        logger.info(`${stubbed_text} -> ${url}`);

        return url;
    } catch (err) {
        logger.error(`Got error while searching wiki: ${err}`);
    }
}

async function parseWikiPage(url) {
    try {
        // We've got a URL, let's grab the page and scrape it for useful information.
        
        const dom = await JSDOM.fromURL(url);

        const doc = dom.window.document;

        // First, get the category of what we've searched for.
        var _category = doc.querySelector(".page-header__categories").children.item(1).textContent;

        let _data = {};

        switch (_category) {
            case "Survivors":
                var _info = doc.querySelector(".infoboxtable");

                const infoItems = _info.children.item(0).children;

                for (var i = 0; i < infoItems.length; i += 1)
                {
                    const element = infoItems.item(i);

                    if (element.children.length === 1 && element.children.item(0).className === "infoboxname") {
                        _data["Name"] = element.children.item(0).textContent.replace("\n", "");
                    }
                    else if (element.children.length == 2) {
                        _data[element.children.item(0).textContent] = element.children.item(1).textContent.replace("\n", "");
                    }
                }

            break;

            case "Items":
                // TODO lol
            break;
        }

        return {
            category: _category,
            wiki_url: url,
            data: _data
        }
    } catch (err) {
        logger.error(`Got error while parsing wiki page ${url}: ${err}`);
    }
}

function renderWikiData(blob) {
    // Render the data contained within the data list as a Markdown document.
    let message;

    switch (blob.category) {
        case "Survivors":
            message = `
**${blob.data.Name}**

_Health_:   ${blob.data["Health"]}
_Regen_:    ${blob.data["Health Regen"]}
_Damage_:   ${blob.data["Damage"]}
_Speed_:    ${blob.data["Speed"]}
_Armor_:     ${blob.data["Armor"]}

${blob.wiki_url}
            `
        break;
    }

    return message;
}

// configure logger settings
logger.remove(logger.transports.Console);
logger.add(new logger.transports.Console, {colorize: true});
logger.level = "debug";

// init discord bot

var bot = new discord.Client({
    token: auth.token,
    autorun: true
});

bot.on("ready", function(evt) {
    logger.info("Connected!");
    logger.info("Logged in as: ");
    logger.info(bot.username + " - (" + bot.id + ")");
})

bot.on("message", function(user, userID, channelID, message, evt){
    // This is where the majority of the bot code is going to happen.
    
    if (message.startsWith("!"))
    {
        // Command!
        var args = message.substring(1).split(/\s+/);
        var cmd = args[0];
        
        args = args.splice(1);
        
        logger.info(`Received command ${cmd} in channel ${channelID} from user ${user} <${userID}>`)

        switch (cmd)
        {
            case "wiki":
                // TODO: Check the channel ID to make sure that we're only responding to messages in the RoR2 channel(s)
                getURLFromQueryText(args.join(" ")).then(url => {
                    return parseWikiPage(url);
                }).then(data => {
                    bot.sendMessage({
                        to: channelID,
                        message: renderWikiData(data)
                    });
                });
            break;

            case "ping":
                bot.sendMessage({
                    to: channelID,
                    message: "Pong!"
                });
            break;

            case "github":
            case "git":
                bot.sendMessage({
                    to: channelID,
                    message: `You can find the source code for this bot at https://github.com/warnespe001/ror2_wiki_bot !`
                });
            break;

            default:
                logger.info(`Got unknown command ${cmd} with args ${args}`);
            break;
        }
    }
});

