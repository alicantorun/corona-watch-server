const express = require("express");
const app = express();
const axios = require("axios");
const cheerio = require("cheerio");
const Redis = require("ioredis");
const config = require("./config.json");
const http = require("http");
const socketIo = require("socket.io");
require("dotenv").config();

const redis = new Redis();

const keys = config.keys;

//Port from environment variable or default - 4001
const port = process.env.PORT || 5000;

//Setting up express and adding socketIo middleware
// const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const Message = require("./Message");
const mongoose = require("mongoose");

const uri = process.env.MONGODB_ATLAS_URI;

mongoose.connect(uri, {
  useUnifiedTopology: true,
  useNewUrlParser: true,
});

//Setting up a socket with the namespace "connection" for new sockets

io.on("connection", (socket) => {
  const { id } = socket.client;
  console.log(`User Connected: ${id}`);
  // Get the last 20 messages from the database.
  Message.find()
    .sort({ createdAt: -1 })
    .limit(20)
    .exec((err, messages) => {
      if (err) return console.error(err);

      // Send the last messages to the user.
      socket.emit("init", messages);
    });

  // Listen to connected users for a new message.
  socket.on("message", (msg) => {
    // Create a message with the content and the name of the user.
    const message = new Message({
      content: msg.content,
      name: msg.name,
    });

    // Save the message to the database.
    message.save((err) => {
      if (err) return console.error(err);
    });

    // Notify all other users about a new message.
    socket.broadcast.emit("push", msg);
  });
});

// io.on("connection", (socket) => {

//   socket.on("chat message", ({ nickname, msg }) => {
//     let message = {};
//     console.log("new message is received", { nickname, msg });
//     message.timeStamp = Date.now();
//     message.nickname = nickname;
//     message.msg = msg;
//     const string = JSON.stringify();
//     redis.set(keys.chat, message);
//     io.emit("chat message", { nickname, msg });
//   });
// });

var getAll = async () => {
  // retrieve raw data
  let response;
  try {
    response = await axios.get("https://www.worldometers.info/coronavirus/");
    if (response.status !== 200) {
      console.log("Error", response.status);
    }
  } catch (err) {
    return null;
  }

  // store parsed data
  const result = {};

  // get HTML and parse data
  const html = cheerio.load(response.data);
  html(".maincounter-number").filter((i, el) => {
    let count = el.children[0].next.children[0].data || "0";
    count = parseInt(count.replace(/,/g, "") || "0", 10);
    if (i === 0) {
      result.cases = count;
    } else if (i === 1) {
      result.deaths = count;
    } else {
      result.recovered = count;
    }
  });

  const active = parseInt(
    html(
      "body > div.container > div:nth-child(2) > div.col-md-8 > div > div:nth-child(14) > div > div.panel-body > div > div.panel_front > div.number-table-main"
    )
      .html()
      .replace(/,/g, "") || "0",
    10
  );
  result.active = active;

  const critical = parseInt(
    html(
      "body > div.container > div:nth-child(2) > div.col-md-8 > div > div:nth-child(14) > div > div.panel-body > div > div.panel_front > div:nth-child(3) > div:nth-child(2) > span"
    )
      .html()
      .replace(/,/g, "") || "0",
    10
  );
  result.critical = critical;
  result.closed = result.cases - result.active;
  result.updated = Date.now();
  const string = JSON.stringify(result);
  redis.set(keys.all, string);
};

var getCountries = async () => {
  let response;
  try {
    response = await axios.get("https://www.worldometers.info/coronavirus/");
    if (response.status !== 200) {
      console.log("Error 666", response.status);
    }
  } catch (err) {
    return null;
  }
  // to store parsed data
  const result = [];
  // get HTML and parse death rates
  const html = cheerio.load(response.data);
  const countriesTable = html("#main_table_countries_today");
  const countriesTableCells = countriesTable
    .children("tbody")
    .children("tr")
    .children("td");

  // NOTE: this will change when table format change in website
  const totalColumns = 13;
  const countryColIndex = 0;
  const casesColIndex = 1;
  const todayCasesColIndex = 2;
  const deathsColIndex = 3;
  const todayDeathsColIndex = 4;
  const curedColIndex = 5;
  const activeColIndex = 6;
  const criticalColIndex = 7;
  const casesPerOneMillionColIndex = 8;
  const deathsPerOneMillionColIndex = 9;
  // minus totalColumns to skip last row, which is total

  for (let i = 0; i < countriesTableCells.length - totalColumns; i += 1) {
    const cell = countriesTableCells[i];

    // get country
    try {
      if (i % totalColumns === countryColIndex) {
        let country =
          cell.children[0].data ||
          cell.children[0].children[0].data ||
          // country name with link has another level
          cell.children[0].children[0].children[0].data ||
          cell.children[0].children[0].children[0].children[0].data ||
          "";

        country = country.trim();
        if (country.length === 0) {
          // parse with hyperlink
          country = cell.children[0].next.children[0].data || "";
        }
        if (
          country !== "Europe" &&
          country !== "North America" &&
          country !== "Ocenia" &&
          country !== "Asia" &&
          country !== "South America" &&
          country !== "Total:" &&
          country !== "Africa"
        )
          result.push({
            country,
          });
      }

      // get cases
      if (i % totalColumns === casesColIndex) {
        let cases = cell.children.length !== 0 ? cell.children[0].data : "";
        result[result.length - 1].cases = parseInt(
          cases.trim().replace(/,/g, "") || "0",
          10
        );
      }
      // get today cases
      if (i % totalColumns === todayCasesColIndex) {
        let cases = cell.children.length !== 0 ? cell.children[0].data : "";
        result[result.length - 1].todayCases = parseInt(
          cases.trim().replace(/,/g, "") || "0",
          10
        );
      }
      // get deaths
      if (i % totalColumns === deathsColIndex) {
        let deaths = cell.children.length !== 0 ? cell.children[0].data : "";
        result[result.length - 1].deaths = parseInt(
          deaths.trim().replace(/,/g, "") || "0",
          10
        );
      }
      // get today deaths
      if (i % totalColumns === todayDeathsColIndex) {
        let deaths = cell.children.length !== 0 ? cell.children[0].data : "";
        result[result.length - 1].todayDeaths = parseInt(
          deaths.trim().replace(/,/g, "") || "0",
          10
        );
      }
      // get cured
      if (i % totalColumns === curedColIndex) {
        let cured = cell.children.length !== 0 ? cell.children[0].data : "";
        result[result.length - 1].recovered = parseInt(
          cured.trim().replace(/,/g, "") || 0,
          10
        );
      }
      // get active
      if (i % totalColumns === activeColIndex) {
        let cured = cell.children.length !== 0 ? cell.children[0].data : "";
        result[result.length - 1].active = parseInt(
          cured.trim().replace(/,/g, "") || 0,
          10
        );
      }
      // get critical
      if (i % totalColumns === criticalColIndex) {
        let critical = cell.children.length !== 0 ? cell.children[0].data : "";
        result[result.length - 1].critical = parseInt(
          critical.trim().replace(/,/g, "") || "0",
          10
        );
      }
      // get total cases per one million population
      if (i % totalColumns === casesPerOneMillionColIndex) {
        let casesPerOneMillion =
          cell.children.length !== 0 ? cell.children[0].data : "";
        result[result.length - 1].casesPerOneMillion = parseFloat(
          casesPerOneMillion.trim().replace(/,/g, "") || "0"
        );
      }

      // get total deaths per one million population
      if (i % totalColumns === deathsPerOneMillionColIndex) {
        let deathsPerOneMillion =
          cell.children.length !== 0 ? cell.children[0].data : "";
        result[result.length - 1].deathsPerOneMillion = parseFloat(
          deathsPerOneMillion.trim().replace(/,/g, "") || "0"
        );
      }
    } catch (error) {}
  }

  const string = JSON.stringify(result.filter((x) => x.country !== "World"));

  redis.set(keys.countries, string);
  console.log(`Updated countries: ${result.length} countries`);
};

var getHistory = async () => {
  let history = await axios
    .get(`https://pomber.github.io/covid19/timeseries.json`)
    .then(async (response) => {
      const res = response.data;
      const hKeys = Object.keys(res);
      let newHistory = [];
      for (key of hKeys) {
        const newArr = res[key].map(({ confirmed: cases, ...rest }) => ({
          cases,
          ...rest,
        }));

        newHistory.push({
          country: key,
          timeline: newArr,
        });
      }
      redis.set(keys.timeline, JSON.stringify(newHistory));
      let globalTimeline = JSON.stringify(
        await calculateAllTimeline(newHistory)
      );
      redis.set(keys.timelineglobal, globalTimeline);
      console.log(`Updated JHU CSSE Timeline`);
    });
};
getCountries();
getAll();
getHistory();

setInterval(getCountries, config.interval);
setInterval(getAll, config.interval);
setInterval(getHistory, config.interval);

let calculateAllTimeline = async (timeline) => {
  let data = {};
  timeline.forEach(async (element) => {
    element.timeline.forEach(async (o) => {
      if (!data.hasOwnProperty(o.date)) {
        data[o.date] = {};
        data[o.date]["cases"] = 0;
        data[o.date]["deaths"] = 0;
        data[o.date]["recovered"] = 0;
      }
      data[o.date].cases += parseInt(o.cases);
      data[o.date].deaths += parseInt(o.deaths);
      data[o.date].recovered += parseInt(o.recovered);
    });
  });
  return data;
};

var listener = server.listen(process.env.PORT || 5000, function () {
  console.log("Your app is listening on port " + listener.address().port);
});

app.get("/", async function (request, response) {
  console.log("hello");
  let a = JSON.parse(await redis.get(keys.all));
  response.send(
    `${a.cases} cases are reported of the COVID-19<br> ${a.deaths} have died from it <br>\n${a.recovered} have recovered from it. <br>
    View the dashboard here : <a href="https://coronastatistics.live">coronastatistics.live</a>`
  );
});

app.get("/all/", async function (req, res) {
  let all = JSON.parse(await redis.get(keys.all));
  res.send(all);
});

app.get("/countries/", async function (req, res) {
  let countries = JSON.parse(await redis.get(keys.countries));

  if (req.query["sort"]) {
    try {
      const sortProp = req.query["sort"];
      countries.sort((a, b) => {
        if (a[sortProp] < b[sortProp]) {
          return -1;
        } else if (a[sortProp] > b[sortProp]) {
          return 1;
        }
        return 0;
      });
    } catch (e) {
      console.error("ERROR while sorting", e);
      res.status(422).send(e);
      return;
    }
  }
  res.send(countries.reverse());
});

app.get("/countries/:country", async function (req, res) {
  let countries = JSON.parse(await redis.get(keys.countries));
  let country = countries.find((e) =>
    e.country.toLowerCase().includes(req.params.country.toLowerCase())
  );
  if (!country) {
    res.send("false");
    return;
  }
  res.send(country);
});

app.get("/timeline", async function (req, res) {
  let data = JSON.parse(await redis.get(keys.timeline));
  res.send(data);
});

app.get("/timeline/global", async function (req, res) {
  let data = JSON.parse(await redis.get(keys.timelineglobal));
  res.send(data);
});

app.get("/timeline/:country", async function (req, res) {
  let data = JSON.parse(await redis.get(keys.timeline));
  let country = data.find(
    (e) => e.country.toLowerCase() === req.params.country.toLowerCase()
  );
  if (!country) {
    res.send(false);
    return;
  }
  country = data.filter(
    (e) => e.country.toLowerCase() === req.params.country.toLowerCase()
  );
  if (country.length === 1) {
    res.send({
      multiple: false,
      name: country[0].country,
      data: country[0],
    });
    return;
  }
  res.send({
    multiple: true,
    name: country[0].country,
    data: country,
  });
});
