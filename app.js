//dependencies for each module used
var express = require('express');
var passport = require('passport');
var InstagramStrategy = require('passport-instagram').Strategy;
var http = require('http');
var path = require('path');
var handlebars = require('express-handlebars');
var bodyParser = require('body-parser');
var session = require('express-session');
var cookieParser = require('cookie-parser');
var dotenv = require('dotenv');
var Instagram = require('instagram-node-lib');
var mongoose = require('mongoose');
var graph = require('fbgraph');
var app = express();

//local dependencies
var models = require('./models');

//client id and client secret here, taken from .env
dotenv.load();
var INSTAGRAM_CLIENT_ID = process.env.INSTAGRAM_CLIENT_ID;
var INSTAGRAM_CLIENT_SECRET = process.env.INSTAGRAM_CLIENT_SECRET;
var INSTAGRAM_CALLBACK_URL = process.env.INSTAGRAM_CALLBACK_URL;
var INSTAGRAM_ACCESS_TOKEN = "";

// set facebook environment variables depending on env file
var FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
var FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
var FACEBOOK_CALLBACK_URL = process.env.FACEBOOK_CALLBACK_URL;
var FACEBOOK_ACCESS_TOKEN = "";

Instagram.set('client_id', INSTAGRAM_CLIENT_ID);
Instagram.set('client_secret', INSTAGRAM_CLIENT_SECRET);

//connect to database
mongoose.connect(process.env.MONGODB_CONNECTION_URL);
var db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function (callback) {
  console.log("Database connected succesfully.");
});

// Passport session setup.
//   To support persistent login sessions, Passport needs to be able to
//   serialize users into and deserialize users out of the session.  Typically,
//   this will be as simple as storing the user ID when serializing, and finding
//   the user by ID when deserializing.  However, since this example does not
//   have a database of user records, the complete Instagram profile is
//   serialized and deserialized.
passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(obj, done) {
  done(null, obj);
});


// Use the InstagramStrategy within Passport.
//   Strategies in Passport require a `verify` function, which accept
//   credentials (in this case, an accessToken, refreshToken, and Instagram
//   profile), and invoke a callback with a user object.
passport.use(new InstagramStrategy({
    clientID: INSTAGRAM_CLIENT_ID,
    clientSecret: INSTAGRAM_CLIENT_SECRET,
    callbackURL: INSTAGRAM_CALLBACK_URL
  },
  function(accessToken, refreshToken, profile, done) {
    // asynchronous verification, for effect...
    models.User.findOrCreate({
      "name": profile.username,
      "id": profile.id,
      "access_token": accessToken 
    }, function(err, user, created) {
      
      // created will be true here
      models.User.findOrCreate({}, function(err, user, created) {
        // created will be false here
        process.nextTick(function () {
          // To keep the example simple, the user's Instagram profile is returned to
          // represent the logged-in user.  In a typical application, you would want
          // to associate the Instagram account with a user record in your database,
          // and return that user instead.
          return done(null, profile);
        });
      })
    });
  }
));

//Configures the Template engine
app.engine('handlebars', handlebars({defaultLayout: 'layout'}));
app.set('view engine', 'handlebars');
app.set('views', __dirname + '/views');
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(session({ secret: 'keyboard cat',
                  saveUninitialized: true,
                  resave: true}));
app.use(passport.initialize());
app.use(passport.session());

//set environment ports and start application
app.set('port', process.env.PORT || 3000);

// Simple route middleware to ensure user is authenticated.
//   Use this route middleware on any resource that needs to be protected.  If
//   the request is authenticated (typically via a persistent login session),
//   the request will proceed.  Otherwise, the user will be redirected to the
//   login page.
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) { 
    return next(); 
  }
  res.redirect('/login');
}

//routes
app.get('/', function(req, res){
  res.render('login');
});

app.get('/login', function(req, res){
  res.render('login', { user: req.user });
});

app.get('/account', ensureAuthenticated, function(req, res){

  var query = models.User.where({name: req.user.username});
  query.findOne(function (err, user) {
    if (err) return handleError(err);
    if (user) {
      Instagram.users.self({
        access_token: user.access_token,
        complete: function(data) {
          //Map will iterate through the returned data obj
          var imageArr = data.map(function(item) {
            //create temporary json object
            tempJSON = {};
            tempJSON.url = item.images.low_resolution.url;
            tempJSON.by = item.user.username;
            tempJSON.comments_count = item.comments.count;
            var time_created = new Date(item.created_time*1000);
            tempJSON.created_time = time_created.toDateString();
            tempJSON.caption = item.caption.text;
            tempJSON.tags = item.tags;
            tempJSON.tags_exist = item.tags.length > 0;
            tempJSON.like_count = item.likes.count;
            tempJSON.media_id = item.id;
            //insert json object into image array
            return tempJSON;
          });
          var photo_caption = data.caption;
          var tags_arr = data.tags;

          //var created_on = new Date(data.created_time);
          res.render('account', {
                                photos: imageArr,
                                user: req.user
                              });
        }
      });
    }    
  });
});

app.post('/account', ensureAuthenticated, function(req, res){
  var query = models.User.where({name: req.user.username});
  query.findOne(function (err, user) {
    if (err) return handleError(err);
    if (user) {
      Instagram.media.like({
        access_token: user.access_token,
        media_id: req.body.media_id,
        complete: function(data) {

          //var created_on = new Date(data.created_time);
          res.redirect('/account');
        }
      });
    }    
  });
});

app.get('/photos', ensureAuthenticated, function(req, res){
  var query  = models.User.where({ name: req.user.username });
  query.findOne(function (err, user) {
    if (err) return handleError(err);
    if (user) {
      // doc may be null if no document matched
      Instagram.users.liked_by_self({
        access_token: user.access_token,
        complete: function(data) {
          //Map will iterate through the returned data obj
          var imageArr = data.map(function(item) {
            //create temporary json object
            tempJSON = {};
            tempJSON.url = item.images.low_resolution.url;
            //insert json object into image array
            return tempJSON;
          });
          res.render('photos', {photos: imageArr});
        }
      }); 
    }
  });
});


// GET /auth/instagram
//   Use passport.authenticate() as route middleware to authenticate the
//   request.  The first step in Instagram authentication will involve
//   redirecting the user to instagram.com.  After authorization, Instagram
//   will redirect the user back to this application at /auth/instagram/callback
app.get('/auth/instagram',
  passport.authenticate('instagram'),
  function(req, res){
    // The request will be redirected to Instagram for authentication, so this
    // function will not be called.
  });

// GET /auth/instagram/callback
//   Use passport.authenticate() as route middleware to authenticate the
//   request.  If authentication fails, the user will be redirected back to the
//   login page.  Otherwise, the primary route function function will be called,
//   which, in this example, will redirect the user to the home page.
app.get('/auth/instagram/callback', 
  passport.authenticate('instagram', { failureRedirect: '/login'}),
  function(req, res) {
    res.redirect('/account');
  });

// get authentication from user
app.get('/auth/facebook', function(req, res) {

  // we don't have a code yet
  // so we'll redirect to the oauth dialog
  if (!req.query.code) {
    var authUrl = graph.getOauthUrl({
        "client_id": FACEBOOK_APP_ID  
      , "redirect_uri": FACEBOOK_CALLBACK_URL
      , "scope": 'email, read_stream, read_friendlists, publish_stream, user_photos, user_about_me, user_status, user_work_history, user_birthday, user_location, user_likes, user_friends, user_interests, user_photos'         
    });

    if (!req.query.error) { //checks whether a user denied the app facebook login/permissions
      res.redirect(authUrl);
    } else {  //req.query.error == 'access_denied'
      res.send('access denied');
    }
    return;
  }

  // code is set
  // we'll send that and get the access token
  graph.authorize({
      "client_id":      FACEBOOK_APP_ID
    , "redirect_uri":   FACEBOOK_CALLBACK_URL
    , "client_secret":  FACEBOOK_APP_SECRET
    , "code":           req.query.code
  }, function (err, facebookRes) {
    if(err) {
      console.log(err);
    }

    res.redirect('/fbaccount');
  });


});  

// user gets sent here after being authorized
app.get('/fbaccount', function(req, res) {

  graph.batch([
    { method: "GET", relative_url: "me"},
    { method: "GET", relative_url: "me/picture?redirect=false&width=300&height=300"},
    { method: "GET", relative_url: "me/likes?filter=stream&limit=10000"},
    { method: "GET", relative_url: "me/photos?filter=stream&limit=1000"},
    { method: "GET", relative_url: "me"}

    ], function(err, data) {

      var info_str_body = data[0].body;
      var profpic_str_body = data[1].body;
      var likes_str_body = data[2].body;
      var photos_str_body = data[3].body;

      var info_json_body = eval("(" + info_str_body + ")");
      var profpic_json_body = eval("(" + profpic_str_body + ")");
      var likes_json_body = eval("(" + likes_str_body + ")");
      var photos_json_body = eval("(" + photos_str_body + ")");

      var likes_count = "" + likes_json_body.data.length;
      if(likes_json_body.data.length === 10000) {
        likes_count = "10000+";
      }

      var photos_count = "" + photos_json_body.data.length;
      if(photos_json_body.data.length === 1000) {
        photos_count = "1000+";
      }

      res.render("fbaccount", 
      { 
        user: info_json_body,
        profile_pic: profpic_json_body.data.url,
        likes_count: likes_count,
        photos_count: photos_count
      });

    });
});


app.get('/logout', function(req, res){
  req.logout();
  res.redirect('/');
});

http.createServer(app).listen(app.get('port'), function() {
    console.log('Express server listening on port ' + app.get('port'));
});
