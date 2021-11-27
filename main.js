var discord = require("discord.io");        // Discord API
var logger = require("winston");            // Logging
var auth = require("./auth.json");          // Auth tokens
var jsdom = require("jsdom");               // Node DOM Support

const { JSDOM } = jsdom;

function sanitizeAndFormat(dirty_text) {
    return encodeURIComponent(dirty_text);
}

async function getURLFromQueryText(stubbed_text) {
    // Search the Risk of Rain 2 wiki for the stubbed text, and return the text of the first search result.
    // TODO: Do error checking here
    
    try 
    {
        const doc = await JSDOM.fromURL(
            `https://riskofrain2.fandom.com/wiki/Special:Search?query=${sanitizeAndFormat(stubbed_text)}&scope=internal&navigationSearch=true`
        );

        // Got the response, parse it for the search results
        var element = doc.window.document.querySelector(".unified-search__result__link");

        var url = element.textContent.replace(/\s/g, "");

        logger.info(`${stubbed_text} -> ${url}`);

        return url;
    } 
    catch (err) 
    {
        logger.error(`Got error while searching wiki: ${err}`);
    }
}

async function parseWikiPage(url) {
    try 
    {
        // We've got a URL, let's grab the page and scrape it for useful information.
        
        const dom = await JSDOM.fromURL(url);

        const doc = dom.window.document;

        // First, get the category/categories of what we've searched for.
        var _categories = []

        var categoryNodes = doc.querySelectorAll("div.page-header__categories a");

        for (var i = 0; i < categoryNodes.length; i++)
        {
            _categories.push(categoryNodes.item(i).textContent);
        }

        logger.info(`Page categories: ${_categories}`);

        let _data = {};

        if (_categories.includes("Survivors")) 
        {
            var infoItems = doc.querySelectorAll("table.infoboxtable tbody tr");

            for (var i = 0; i < infoItems.length; i += 1)
            {
                const element = infoItems.item(i);

                if (element.children.length === 1 && element.firstElementChild.className === "infoboxname") 
                {
                    _data["Name"] = element.firstElementChild.textContent.replace("\n", "");
                }
                else if (element.children.length == 2) 
                {
                    _data[element.firstElementChild.textContent] = element.children.item(1).textContent.replace("\n", "");
                }
            }
        }
        else if (_categories.includes("Items"))
        {
            // TODO lol
            
            var infoItems = doc.querySelectorAll("table.infoboxtable tbody tr");

            for (var i = 0; i < infoItems.length; i += 1)
            {
                const element = infoItems.item(i);

                if (element.children.length === 1)
                {
                    if (element.firstElementChild.className === "infoboxname" && i === 0)
                    {
                        _data["Name"] = element.firstElementChild.textContent.replace("\n", "");
                    }
                    else if (element.firstElementChild.className === "infoboxdesc")
                    {
                        // TODO are span nodes going to cause an issue here?
                        _data["Description"] = element.firstElementChild.textContent.replace("\n", "");
                    }
                }
                else if (i === infoItems.length - 1)
                {
                    // This is most likely the stats row.
                    _data["Stats"] = {
                        "Stat": element.children.item(0).textContent,
                        "Value": element.children.item(1).textContent,
                        "StackType": element.children.item(2).textContent,
                        "StackAmount": element.children.item(3).textContent,
                    };
                }

            }
        }

        return {
            categories: _categories,
            wiki_url: url,
            data: _data
        };
    } 
    catch (err) 
    {
        logger.error(`Got error while parsing wiki page ${url}: ${err}`);
    }
}

async function getNewtAltarLocations(url) {
    throw new Error("Lorem ipsum");
}

function renderWikiData(blob) {
    // Render the data contained within the data list as a Markdown document.
    let message;

    if (blob.categories.includes("Survivors"))
    {
        message = `
**${blob.data.Name}**

_Health_:   ${blob.data["Health"]}
_Regen_:    ${blob.data["Health Regen"]}
_Damage_:   ${blob.data["Damage"]}
_Speed_:    ${blob.data["Speed"]}
_Armor_:     ${blob.data["Armor"]}

${blob.wiki_url}`
    }
    else if (blob.categories.includes("Items"))
    {
        message = `
**${blob.data.Name}**

${blob.data["Description"]}

**Affected Stat**:  ${blob.data["Stats"]["Stat"]}
**Value**:          ${blob.data["Stats"]["Value"]}
**Stacking Type**:  ${blob.data["Stats"]["StackType"]}
**Stack Amount**:   ${blob.data["Stats"]["StackAmount"]}

${blob.wiki_url}`
    }

    // TODO: Do Items, but better

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
    
    if (message.startsWith("!") && auth.whitelisted_channels.includes(channelID))
    {
        // Command!
        var args = message.substring(1).split(/\s+/);
        var cmd = args[0];
        
        args = args.splice(1);
        
        logger.info(`Received command ${cmd} in channel ${channelID} from user ${user} <${userID}>`)

        switch (cmd)
        {
            case "wiki":
                getURLFromQueryText(args.join(" ")).then(
                    url => {
                        return parseWikiPage(url);
                    }
                ).then(
                    data => {
                        bot.sendMessage({
                            to: channelID,
                            message: renderWikiData(data)
                        });
                    }
                ).catch(
                    err => {
                        logger.error(`Failed to run wiki command; reason: ${err}`);
                    }
                );
            break;

            case "newt":
                // Get the wiki URL for the indicated stage, and then look for the "Newt Altars" section.
                getURLFromQueryText(args.join(" ")).then(
                    url => {
                        return getNewtAltarLocations(url);  
                    }
                ).then(
                    data => {
                        bot.sendMessage({
                            to: channelID,
                            message: renderWikiData(data)
                        });
                    }
                ).catch(
                    err => {
                        logger.error(`Failed to run newt command; reason: ${err}`);
                    }
                );
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
    else
    {
        logger.info(`Got message ${message} in channel ${channelID} from user ${user} <${userID}>`);
    }
});

