var sslRedirect = require('heroku-ssl-redirect');
var express = require('express');
var bodyParser = require('body-parser');
var async = require('async');
var app = express();
var fs = require('fs');
var jwt = require('jsonwebtoken');
var portNum = (process.env.PORT || 5000);
var server = app.listen(portNum, function(){});
var req = require('request');
var qs = require('querystring');
var ProductionDomain = 'https://login.salesforce.com';
var loginURL = '/services/oauth2/token';
var clientId = process.env.APP_CLIENT_ID;
var clientSecret = process.env.APP_CLIENT_SECRET;
var version = 'v40.0';
var domainURL = 'https://api.einstein.ai/v2';
var modelId = process.env.EINSTEIN_MODEL_ID;
var accountid = process.env.EINSTEIN_VISION_ACCOUNT_ID;
var pky = process.env.EINSTEIN_VISION_PRIVATE_KEY;
var sfdc_username = process.env.SALESFORCE_USERNAME;
var sfdc_password = process.env.SALESFORCE_PASSWORD;

app.use(sslRedirect());
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.json({limit: '100mb'}));
app.use(bodyParser.urlencoded({limit: '100mb', extended: true, parameterLimit:50000}));
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');
app.post('/img', function(req, res) {
	try{
	    var b64 = req.body.b64;
	    var predictionResult;
	    async.waterfall([
		function(callback){
		    // Einstein Vision API: アクセストークン取得
		    
		    loginEinsteinVision(callback);
		},
		function(obj, callback){
		    // Einstein Vision API: 予測実行
		    predictImage(obj, b64, callback);
		},
		function(obj, callback){
		    // インターホン呼機(Raspberry Pi)に予測結果をレスポンス
		    res.send(obj);
		    // Salesforce REST API: アクセストークン取得
		    predictionResult = obj;
		    loginSalesforce(callback);
		},
		function(obj, callback){
		    // Salesforce REST API: プラットフォームイベントをパブリッシュ
		    publishPlatformEvent(obj, predictionResult, callback);
		},
		function(callback){
		    // イメージファイルを書き込み
		    fs.writeFile("public/camera.jpg", b64, 'base64', function(err){
			if(err){
			    callback(err);
			} else {
			    callback(null);
			}
		    });	
		}
	    ], function (err, result){
	    });
            
	} catch(error){
	    console.log(error);
	}
});
function publishPlatformEvent(obj, predictionResult, callback){
	req.post({
		headers: {
			'Content-Type': 'application/json',
			'Authorization': 'Bearer ' + obj.access_token},
			body: JSON.stringify({
				'Type__c' : 'インターホン呼び出し',
				'Message__c' : predictionResult
			}),
			url: obj.instance_url + '/services/data/' + version + '/sobjects/Call__e/'
		}, function(err, res, body){
			if (err){
				callback(err);
			} else {
				callback(null);
			}
		});
}
function loginSalesforce(callback){
	req.post({
		headers: {'Content-Type': 'application/x-www-form-urlencoded'},
		url: ProductionDomain + loginURL,
		body: qs.stringify({
			client_id : clientId,
			client_secret : clientSecret,
			grant_type : encodeURIComponent('password'),
			username : sfdc_username,
			password : sfdc_password
		})
	}, function(err, res, body){
		if (err){
			callback(err);
		} else {
			console.log('LOGINED:' + body);
			callback(null, JSON.parse(body));
		}
	});
}
function loginEinsteinVision(callback){
	var un = accountid;
	var authURI = domainURL + '/oauth2/token';
	var assertion = jwt.sign({
		"sub": un,
		"aud": authURI
	}, pky, {
		header: {
			alg: "RS256",
			typ: "JWT"
		},
		expiresIn: '3m'
	});
	req.post({
		url: authURI,
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'accept': 'application/json'
		},
		body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(assertion)}`
	}, function(err, res, body) {
		if(err){
			callback(err);
		} else {
			console.log('LOGINED:' + body);
			callback(null, JSON.parse(body));
		}
	});
}
function predictImage(obj, b64, callback){
	req.post({
		headers: {
			'Cache-Control': 'no-cache',
			'Content-Type': 'multipart/form-data',
			'Authorization': 'Bearer ' + obj.access_token
		},
		formData: {
			sampleBase64Content : b64,
			modelId : modelId
		},
		url: domainURL + '/vision/predict'
	}, function(err, res, body){
		if (err){
			callback(err);
		} else {
			console.log(body);
			callback(null, body);
		}
	});		
}
