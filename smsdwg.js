/**********************************************
 * Author: Chizhov Nikolay <admin@kgd.in>     *
 * Date: 16-09-2013                           *
 * Jabber: nikolay@kgd.in                     *
 *                                            *
 * !!!ONLY DWG SMS API 1.4!!!                 *
 **********************************************/

//Configs
var config =
{
  dwg_port: 12000, //DWG Port
  send_path: '/var/spool/dwgjs/send/', //SMS Send Path
  income_path: '/var/spool/dwgjs/incoming/', //SMS Income path
  ussd_send_path: '/var/spool/dwgjs/ussd_send/',  //USSD Command Send Path
  ussd_income_path: '/var/spool/dwgjs/ussd_incoming/', //USSD Income Path
  run_program: '/etc/local_scripts/radius2.php', //External Program for execute after receivenig SMS
  debug: true, //Debugging
};

var net = require("net"), fs = require("fs"), exec = require("child_process").exec;

var flag =
{
  read_file: 1
};

function parseDWG(data, socket)
{
  data = data.toString();
  while (data)
  {
    var dwg = [];
    dwg["length"] = parseInt(data.substr(0, 8), 16);
    dwg["mac"] = data.substr(8, 12);
    dwg["time"] = data.substr(24, 8);
    dwg["position"] = data.substr(32, 8);
    dwg["type"] = data.substr(40, 4);
    dwg["id"] = data.substr(8, 40);
    dwg["body"] = data.substr(48, dwg["length"]*2);
    if (data.length > 47)
    {
      Logger("[PROCESS] <- " + leadZero(dwg["length"].toString(16), 8) + dwg.id + dwg.body, true);
      var hex = parseFlag(dwg, socket);
      if (hex != "")
      {
        Logger("[PROCESS] -> " + hex, true);
        var buffer = new Buffer(hex, 'hex');
        socket.write(buffer);
      }
      data = data.substr(48 + dwg["length"]*2);
    }
    else
    {
      break;
    }
  }
}

//For parse body, type, dwg_id, socket
function parseFlag(dwg, socket)
{
  var hex = "";
  var body = dwg.mac + "0000" + dwg.time + dwg.position;
  switch (dwg.type)
  {
    //Status message
    case "0007":
      body += "0008" + "0000";
      hex = createFullHeader(body, "00");
      break;
    //Receive SMS
    case "0005":
      body += "0006" + "0000";
      //SMS Parsing
      var sms = parseSMS(dwg["body"]);
      saveSMS(sms);
      hex = createFullHeader(body, "00");
      break;
    //Sending SMS
    case "0002":
      if (dwg["body"] !== "00")
      {
        flag.read_file = 1;
      }
      break;
    case "0003":
      body += "0004" + "0000";
      hex = createFullHeader(body, "00");
      flag.read_file = 1;
      break;
    //Sending USSD
    case "000a":
      flag.read_file = 1;
      break;
    //Receiving USSD
    case "000b":
      body += "000c" + "0000";
      var ussd  = parseUSSD(dwg["body"]);
      saveUSSD(ussd);
      hex = createFullHeader(body, "00");
      break;
  }
  return hex;
}

function periodSend(socket)
{
  setInterval((function()
  {
    var memory = process.memoryUsage();
    var hex = createFullHeader(createHeader("0"), "");
    var buffer = new Buffer(hex, 'hex');
    socket.write(buffer);
    Logger("[SYSTEM] heapTotal: " + Math.floor(memory.heapTotal/1024) + " Kb, heapUsed: " + Math.floor(memory.heapUsed/1024) + " Kb", true);
    Logger("[PROCESS] -> " + hex, true);    
  }), 45000);
}

function readSMSd(socket)
{
  setInterval((function()
  {
    if (flag.read_file == 1)
    {
      fs.readdir(config.send_path, function(err, files)
      {
        for (var f = 0; f < files.length; f++)
        {
          fs.readFile(config.send_path + files[f], "utf8", function(err, data)
          {
            var fdata = data.toString().split("\n");
            var body = "";
            for (var i = 2; i < fdata.length; i++)
            {
              body += fdata[i] + "\n";
            }
            var hex = createFullHeader(createHeader("1"), buildSMS(fdata[0], fdata[1], body));
            Logger("[DATA] Sending SMS to number " + fdata[0], false);
            var buffer = new Buffer(hex, 'hex');
            socket.write(buffer);
            Logger("[PROCESS] -> " + hex, true);
            flag.read_file = 0;
          });
          fs.unlink(config.send_path + files[f], function(err) { });
          break;
        }
      });
    }
    if (flag.read_file == 1)
    {
      fs.readdir(config.ussd_send_path, function(err, files)
      {
        for (var f = 0; f < files.length; f++)
        {
          fs.readFile(config.ussd_send_path + files[f], "ascii", function(err, data)
          {
            var fdata = data.toString().split("\n");
            var hex = createFullHeader(createHeader("9"), buildUSSD(fdata[0], fdata[1]));
            Logger("[DATA] Sending USSD command " + fdata[1] + " to port " + fdata[0], false);
            var buffer = new Buffer(hex, 'hex');
            socket.write(buffer);
            Logger("[PROCESS] -> " + hex, true);
            flag.read_file = 0;
          });
          fs.unlink(config.ussd_send_path + files[f], function(err) { });
          break;
        }
      });
    }
  }), 10000);
}

var server = net.createServer(function(socket)
{
  socket.setEncoding("hex");
  Logger("[SYSTEM] Client connected " + socket.remoteAddress, false);
  socket.on("end", function()
  {
    Logger("[SYSTEM] Client disconnected", false);
  });
  socket.on("data", function(data)
  {
    parseDWG(data, socket);
  });
  readSMSd(socket);
  periodSend(socket);
});

server.listen(config.dwg_port, function()
{
  Logger("[SYSTEM] Server listening...", false);
});

server.setMaxListeners(0);

//Adding leading zeros
function leadZero(data, length)
{
  data = data.toString();
  var zeros = ""
  for (var i = 0; i < (length - data.length); i++)
  {
    zeros += "0";
  }
  return zeros + data;
}

//Creating random header
function createHeader(type)
{
  var header = "00fab3d2d3aa0000"; //Mac
  header += leadZero(Math.round(new Date().getTime()/1000).toString(16), 8); //Time
  header += leadZero(Math.floor(Math.random()*268435455).toString(16), 8); //Serial
  header += leadZero(type, 4); //Type
  header += leadZero("", 4); //Flag
  return header;
}

//Creating full headers
function createFullHeader(header, body)
{
  return leadZero(Math.round(body.length/2).toString(16), 8) + header + body;
}

//Parse SMS data
function parseSMS(data)
{
  var sms = [];
  sms["number"] = toASCII(data.substr(0, 48)); 
  sms["type"] = parseInt(data.substr(48, 2), 16);
  sms["port"] = parseInt(data.substr(50, 2), 16);
  sms["time"] = toASCII(data.substr(52, 30));
  sms["timezone"] = parseInt(data.substr(82, 2), 16);
  sms["encoding"] = parseInt(data.substr(84, 2), 16);
  sms["length"] = parseInt(data.substr(86, 4), 16);
  if (sms["encoding"] == 0)
  {
    sms["content"] = toASCII(data.substr(90));
  }
  else if (sms["encoding"] == 1)
  {
    sms["content"] = toUnicode(data.substr(90));
  }
  return sms;
}

//Parse USSD data
function parseUSSD(data)
{
  var ussd = [];
  ussd["port"] = parseInt(data.substr(0, 2), 16);
  ussd["status"] = parseInt(data.substr(2, 2), 16);
  ussd["length"] = parseInt(data.substr(4, 4), 16);
  ussd["encoding"] = parseInt(data.substr(8, 2), 16);
  if (ussd["encoding"] == 0)
  {
    ussd["content"] = toASCII(data.substr(10));
    //Second encoding for Russian (DWG SMS API 1.4)
    if (ussd["content"].substr(0, 1) == "0" && ussd["content"].substr(4, 1) == "0")
    {
      ussd["content"] = toUnicode(ussd["content"]);
    }
  }
  else if (ussd["encoding"] == 1)
  {
    ussd["content"] = toUnicode(data.substr(10));
  }
  return ussd;
}

//Save SMS to folder
function saveSMS(data)
{
  var time = new Date().getTime();
  var stream = fs.createWriteStream(config.income_path + data["number"] + "." + time.toString());
  stream.once("open", function(fd)
  {
    stream.write("Number: " + data["number"] + "\n");
    stream.write("Port: " + data["port"] + "\n");
    stream.write("Time: " + data["time"] + "\n");
    stream.write("Timezone: " + data["timezone"] + "\n");
    stream.write("Encoding: " + data["encoding"] + "\n\n");
    stream.write(data["content"]);
    stream.end();
  });
  Logger("[DATA] Received SMS from number " + data["number"], false);
  if (config.run_program != "") runSMSprogram();
}

//Save USSD to folder
function saveUSSD(data)
{
  var time = new Date().getTime();
  var stream = fs.createWriteStream(config.ussd_income_path + data["port"] + "." + time.toString());
  stream.once("open", function(fd)
  {
    stream.write("Port: " + data["port"] + "\n");
    stream.write("Time: " + getDate() + "\n");
    stream.write("Status: " + data["status"] + "\n");
    stream.write("Encoding: " + data["encoding"] + "\n\n");
    stream.write(data["content"]);
    stream.end();
  });
  Logger("[DATA] Received USSD from port " + data["port"], false);
}

function runSMSprogram()
{
  var child = exec(config.run_program, function(err, stdout, stderr)
  {
    
  });
}

//Build SMS for sending
function buildSMS(number, port, body)
{
  var pdata = leadZero(port, 2) + "010001" + fromASCII(number, 24);
  var pbody = fromUnicode(body);
  pdata += leadZero(Math.round(pbody.length/2).toString(16), 4) + pbody;
  return pdata;
}

//Build USSD for Sending
function buildUSSD(port, number)
{
  var pdata = leadZero(port, 2) + "01";
  var pbody = fromASCII(number, number.length);
  pdata += leadZero(Math.round(pbody.length/2).toString(16), 4) + pbody;
  return pdata;
}

/**********************************
 * Additional sub functions       *
 **********************************/

//Converting to ASCII
function toASCII(data)
{
  var pdata = "";
  for (var i = 0; i < data.length; i += 2)
  {
    if (data.substr(i, 2) != "00")
    {
      pdata += String.fromCharCode(parseInt(data.substr(i, 2), 16));
    }
  }
  return pdata;
}

//Converting to Unicode
function toUnicode(data)
{
  var pdata = "";
  for (var i = 0; i < data.length; i += 4)
  {
    pdata += String.fromCharCode(parseInt(data.substr(i, 4), 16));
  }
  return pdata;
}

//Converting from ASCII
function fromASCII(data, bytes)
{
  var pdata = "";
  for (var i = 0; i < bytes; i++)
  {
    pdata += (data.length > i) ? leadZero(data.charCodeAt(i).toString(16), 2) : "00";
  }
  return pdata;
}

//Converting from Unicode
function fromUnicode(data)
{
  var pdata = "";
  for (var i = 0; i < data.length; i++)
  {
    pdata += leadZero(data.charCodeAt(i).toString(16), 4);
  }
  return pdata;
}

//Getting date
function getDate()
{
  var date = new Date();
  return addzero(date.getDate()) + "." + addzero(date.getMonth()) + "." + date.getFullYear() + " " + 
         addzero(date.getHours()) + ":" + addzero(date.getMinutes()) + ":" + addzero(date.getSeconds());
}

//Add zero date
function addzero(i)
{
  return (i < 10) ? "0" + i : i;
}

//Console logging
function Logger(data, debug)
{
  if (debug && config.debug)
  {
    console.log("[" + getDate() + "] " + data);
  }
  else if (!debug)
  {
    console.log("[" + getDate() + "] " + data);
  }
}
