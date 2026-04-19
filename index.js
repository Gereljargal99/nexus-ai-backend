import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.TWELVE_DATA_KEY;

function ema(data, period){
  let k = 2/(period+1);
  let arr=[data[0]];
  for(let i=1;i<data.length;i++){
    arr.push(data[i]*k + arr[i-1]*(1-k));
  }
  return arr;
}

function rsi(data){
  let gain=0, loss=0;
  for(let i=1;i<data.length;i++){
    let d=data[i]-data[i-1];
    if(d>0) gain+=d;
    else loss+=d;
  }
  let rs = gain/(loss||1);
  return 100 - (100/(1+rs));
}

app.post("/signal", async (req,res)=>{
  const {pair} = req.body;

  const url = `https://api.twelvedata.com/time_series?symbol=${pair}&interval=5min&outputsize=80&apikey=${API_KEY}`;

  const r = await fetch(url);
  const data = await r.json();

  if(!data.values){
    return res.json({error:"no data"});
  }

  let closes = data.values.reverse().map(x=>parseFloat(x.close));

  let e9 = ema(closes,9);
  let e21 = ema(closes,21);

  let last = closes.length-1;

  let rsiVal = rsi(closes.slice(-14));

  let trend = e9[last] - e21[last];

  let signal = "WAIT";

  if(trend > 0 && rsiVal > 50) signal = "BUY";
  if(trend < 0 && rsiVal < 50) signal = "SELL";

  res.json({
    pair,
    signal,
    rsi: rsiVal,
    trend
  });
});

app.listen(3000, ()=>{
  console.log("AI backend running");
});
