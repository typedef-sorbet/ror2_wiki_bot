var discord = require("discord.io");        // Discord API
var logger = require("winston");            // Logging
var auth = require("./auth.json");          // Auth tokens
var jsdom = require("jsdom");               // Node DOM Support
const { child } = require("winston");

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
    // Grab the page from the URL.
    const dom = await JSDOM.fromURL(url, {resources: "usable"});

    const doc = dom.window.document;

    // Check to make sure that this is a stage page. If it isn't, then we're kinda screwed.
    var isEnvironment = false;

    var categoryNodes = doc.querySelectorAll("div.page-header__categories a");

    for (var i = 0; i < categoryNodes.length; i++)
    {
        if (categoryNodes.item(i).textContent === "Environments")
        {
            isEnvironment = true;
        }
    }

    if (!isEnvironment)
    {
        throw new Error("Specified wiki page does not specify an environment");
    }

    _data = {}

    // Get the page name.
    _data["Stage Name"] = doc.querySelector("h1#firstHeading").textContent.replace(/(\n|\t)/g, "");

    // Look for the Newt Altar section on the wiki.
    var newtAltarSpan = doc.querySelector("h2 span#Newt_Altars");

    // Check to make sure we actually grabbed something there.
    if (newtAltarSpan === null)
    {
        throw new Error("Stage does not have any Newt Altars.");
    }

    // That grabbed the span inside of an <h2> tag. The list we want is a sibling of that <h2> tag.
    // Find it.
    var nodePtr = newtAltarSpan.parentElement;

    while (nodePtr.tagName !== "OL")
    {
        nodePtr = nodePtr.nextSibling;
    }

    // Should be OL
    logger.info(`First node: tagName: ${nodePtr.tagName}`);

    // nodePtr is now pointing at the ordered list, presumably.
    // TODO should probably do some error checking on that lol

    _data["Locations"] = [];
    for (var i = 0; i < nodePtr.children.length; i++)
    {
        var listItem = nodePtr.children.item(i);

        _data["Locations"].push(`* ${listItem.textContent}`);
    }

    _data["Images"] = [];

    // Grab all of the image tags that call out Newt Altars.
    var imageNodes = doc.querySelectorAll("img");

    for (var i = 0; i < imageNodes.length; i++)
    {
        var imageNode = imageNodes.item(i);

        if (imageNode.hasAttribute("data-image-key") && imageNode.getAttribute("data-image-key").includes("_NA"))
        {
            // logger.info(`Found image: ${imageNode.getAttribute("src")}`);
            _data["Images"].push(imageNode.parentNode.getAttribute("href"));
        }
    }

    return {
        categories: ["Newt Altars"],
        wiki_url: url,
        data: _data
    };
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
    else if (blob.categories.includes("Newt Altars"))
    {
        message = `
** Newt Altars on ${blob.data["Stage Name"]} **

${blob.data["Stage Name"]} has Newt Altars in the following locations:

${blob.data["Locations"].join("\n")}
`
    }

    // TODO: Do Items, but better

    return message;
}

async function sleep(ms)
{
    await new Promise(resolve => setTimeout(resolve, ms));
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
                    blob => {
                        bot.sendMessage({
                            to: channelID,
                            message: renderWikiData(blob)
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
                    blob => {
                        bot.sendMessage({
                            to: channelID,
                            message: renderWikiData(blob)
                        },
                        (err, resp) => {
                            for (var i = 0; i < blob.data["Images"].length; i++)
                            {
                                bot.sendMessage({
                                    to: channelID,
                                    message: "",
                                    embed: {
                                        image: {
                                            url: blob.data["Images"][i]
                                        }
                                    }
                                });
                            }
                        });
                    }
                ).catch(
                    err => {
                        logger.error(`Failed to run newt command; reason: ${err}`);
                        bot.sendMessage({
                            to: channelID,
                            message: err
                        });
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

