(function() {

    var trakt = require('./js/frontend/providers/trakttv');
    var async = require('async');
    //var request = require('request');
    function request (uri, options, callback) {
        if (typeof uri === 'undefined') throw new Error('undefined is not a valid uri or options object.');
        if ((typeof options === 'function') && !callback) callback = options;
        if (options && typeof options === 'object') {
            options.uri = uri;
        } else if (typeof uri === 'string') {
            options = {uri:uri};
        } else {
            options = uri;
        }

        var jqueryOptions = {
            url: options.uri || options.url
        }
        if(options.json)
            jqueryOptions.dataType = 'json';
        if(options.headers)
            jqueryOptions.headers = options.headers;
        if(options.method)
            jqueryOptions.type = options.method;
        if(options.body)
            jqueryOptions.data = options.body.toString();
        if(options.timeout)
            jqueryOptions.timeout = options.timeout;

        $.ajax(jqueryOptions)
            .done(function(data, status, xhr) {
                console.logger.debug("%O", data);
                callback(undefined, xhr, data);
            })
            .fail(function(xhr, status, err) {
                console.logger.error("%O", data);
                callback(err, xhr, undefined);
            });
    }

//    var url = Settings.get('yifyApiEndpoint') + 'list.json?sort=seeds&limit=50';
	var url = 'https://apify.heroku.com/api/eztv.json';

	counter = 0;

    // Hack to keep to cancel the request in case of new request
    var currentRequest = null;

    var Yts = Backbone.Collection.extend({
        apiUrl: url,
        model: App.Model.Movie,
        movies: [],

        initialize: function(models, options) {
            if (options.keywords) {
                this.apiUrl += '&keywords=' + options.keywords;
            }

            if (options.genre) {
                if (options.genre == 'date') {
                  this.apiUrl += '&genre=all&sort=date';
                } else {
                  this.apiUrl += '&genre=' + options.genre;
                }
            }

            if (options.page && options.page.match(/\d+/)) {
                this.apiUrl += '&set=' + options.page;
            }

            this.options = options;
            Yts.__super__.initialize.apply(this, arguments);
        },

        addMovie: function(model) {
            var stored = _.find(this.movies, function(movie) { return movie.imdb == model.imdb });

            // Create it on memory map if it doesn't exist.
            if (typeof stored === 'undefined') {
                stored = model;
            }

            if (stored.quality !== model.quality && model.quality === '720p') {
                stored.torrent = model.torrent;
                stored.quality = '720p';
            }

            // Set it's correspondent quality torrent URL.
            stored.torrents[model.quality] = model.torrent;

            // Push it if not currently on array.
            if (this.movies.indexOf(stored) === -1) {
                this.movies.push(stored);
            }
        },

        fetch: function() {
            var collection = this;

            this.movies = [];

            if(currentRequest) {
                currentRequest.abort();
            }

            console.logger.debug('Requesting from YTS: %s', this.apiUrl);
            console.time('YTS Request Took');
            var thisRequest = currentRequest = request(this.apiUrl, {json: true}, function(err, res, ytsData) {
                console.timeEnd('YTS Request Took');
                var i = 0;

                if(err) {
                    collection.trigger('error');
                    return;
                }

	            if (ytsData.error) {
                    collection.set(collection.movies);
                    collection.trigger('loaded');
                    return;
                }

			var names = _.pluck(ytsData, 'epinfo');
			var regex = /[S,s][0-9][0-9].*|[^0-9][0-9,.][0-9][x,X][0-9].*|[S,s]eries.*|SERIES.*|SEASON.*|[S,s]eason.*|20[0-1][0-9].*|[0-9]of[0-9].*/g;
			var matched = null;
			ytsData.forEach(function (movie) {
				matched = null;
				while (matched = regex.exec(movie.epinfo)) {
					movie.showName=((movie.epinfo).replace(matched[0],"")).trim();
					movie.ImdbCode=nameIMDB[movie.showName.toLowerCase()];
					if(movie.ImdbCode==null){
						counter++;
						movie.ImdbCode=(counter+'');
						nameIMDB[movie.showName.toLowerCase()]=movie.ImdbCode;
					}
				movie.year=matched[0];
				}
				if(movie.showName==null)
					{
					movie.showName=movie.epinfo;
					movie.year='EZTV';
					counter++;
					movie.ImdbCode=(counter+'');
					nameIMDB[movie.showName.toLowerCase()]=movie.ImdbCode;
					}
			})


	            //var imdbCodes = _.pluck(ytsData, 'ImdbCode');
                var imdbIds = _.unique(_.pluck(ytsData, 'ImdbCode'));

                App.Providers.YSubs.fetch(_.map(imdbIds, function(id){return id.replace('tt','');}))
                .then(function(subtitles) {
                    async.filterSeries(
                      imdbIds,
                      function(cd, cb) { App.Cache.getItem('trakttv', cd, function(d) { cb(d == undefined) }) },
                      function(imdbCodes) {
                        var traktMovieCollection = new trakt.MovieCollection(imdbCodes);
                        traktMovieCollection.getSummaries(function(trakData) {
                            // Check if new request was started
                            if(thisRequest !== currentRequest) return;

                            i = ytsData.length;
                            ytsData.forEach(function (movie) {
                                // No imdb, no movie.
                                if( typeof movie.ImdbCode != 'string' || movie.ImdbCode.replace('tt', '') == '' ){ return; }

                                var traktInfo = _.find(trakData, function(trakMovie) { return trakMovie.imdb_id == movie.ImdbCode });

                                var torrents = {};
                                torrents[movie.Quality] = movie.TorrentUrl;

                                var imdbId = movie.ImdbCode.replace('tt', '');
                                // Temporary object
                                var movieModel = {
                                    imdb:       imdbId,
                        title:      movie.showName,
                        year:       movie.year,
                        //runtime:    +traktInfo.runtime || 0,
                        synopsis:   "",
                        //voteAverage:parseFloat(movie.MovieRating),

                        image:     null,
                        bigImage:  null,
                        backdrop:  null,

                        //quality:    movie.Quality,
                        torrent:    (movie.download2).replace("/","\/"),
                                    torrents:   torrents,
                                    videos:     {},
                                    subtitles:  subtitles[imdbId],
                        seeders:    "150",
                        leechers:   "0",

                                    // YTS do not provide metadata and subtitle
                                    hasSubtitle:true
                                };

                                if(traktInfo) {
                                    movieModel.image = trakt.resizeImage(traktInfo.images.poster, '138');
                                    movieModel.bigImage = trakt.resizeImage(traktInfo.images.poster, '300');
                                    movieModel.backdrop = trakt.resizeImage(traktInfo.images.fanart, '940');
                                    movieModel.synopsis = traktInfo.overview;
                                    movieModel.runtime = +traktInfo.runtime;
                                    App.Cache.setItem('trakttv', traktInfo.imdb_id, traktInfo);
                                    console.logger.warn('Trakt.tv Cache Miss %O', traktInfo);
                                    collection.addMovie(movieModel);
                                    if(--i == 0) {
                                        collection.set(collection.movies);
                                        collection.trigger('loaded');
                                    }
                                } else {
                                    App.Cache.getItem('trakttv', movie.ImdbCode, function(traktInfo) {
                                        if(traktInfo) {
                                            movieModel.image = trakt.resizeImage(traktInfo.images.poster, '138');
                                            movieModel.bigImage = trakt.resizeImage(traktInfo.images.poster, '300');
                                            movieModel.backdrop = trakt.resizeImage(traktInfo.images.fanart, '940');
                                            movieModel.synopsis = traktInfo.overview;
                                            movieModel.runtime = +traktInfo.runtime;
                                        }
                                        console.logger.debug('Trakt.tv Cache Hit %O', traktInfo);
                                        collection.addMovie(movieModel);
                                        if(--i == 0) {
                                            collection.set(collection.movies);
                                            collection.trigger('loaded');
                                        }
                                    });
                                }
                            });
                        })
                    })
                });
            })
        }
    });

var nameIMDB = {
"10 oclock live": "tt2910678",
"the 100": "tt2661044",
"2 broke girls": "tt1845307",
"24 live another day": "tt1598754",
"5 inch floppy": "tt0629238",
"60 minutes us": "tt0123338",
"a touch of cloth": "tt2240991",
"about a boy": "tt2666270",
"the academy awards oscars": "tt2796782",
"adventure time": "tt1305826",
"the after": "tt3145422",
"alan carrs new year specstacular": "tt2607818",
"ali g rezurection": "tt0367274",
"almost human": "tt2654580",
"alpha house": "tt3012160",
"the amazing race": "tt0285335",
"ambassadors": "tt2382598",
"american dad": "tt0397306",
"american horror story": "tt1844624",
"american idol": "tt0319931",
"the americans": "tt2149175",
"americas got talent": "tt0759364",
"americas next top model": "tt0363307",
"an idiot abroad": "tt1702042",
"anger management": "tt0305224",
"annual grammy awards": "tt2627702",
"anthony bourdain parts unknown": "tt2849368",
"the apprentice uk": "tt0450897",
"the apprentice": "tt0364782",
"aqua teen hunger force": "tt0297494",
"archer": "tt1486217",
"arctic air": "tt1974470",
"arrow": "tt2193021",
"the arsenio hall show": "tt2311336",
"the assets": "tt3074646",
"atlantis": "tt2705602",
"awkward": "tt1663676",
"axe cop": "tt2497834",
"baby daddy": "tt2177489",
"babylon": "tt3138900",
"bad education": "tt2337840",
"banshee": "tt2017109",
"bates motel": "tt2188671",
"beauty and the beast": "tt0101414",
"being human us": "tt1595680",
"being mary jane": "tt2345481",
"believe": "tt2592094",
"the best laid plans": "tt2820078",
"betas": "tt2797618",
"betrayal": "tt2751074",
"betty whites off their rockers": "tt1879713",
"the big bang theory": "tt0898266",
"big school": "tt2827534",
"bikinis and boardwalks": "tt2788282",
"biography channel documentaries": "tt0092322",
"birds of a feather": "tt0096545",
"bitten": "tt2365946",
"black dynamite": "tt1190536",
"black gold": "tt1701210",
"black mirror": "tt2085059",
"black sails": "tt2375692",
"the blacklist": "tt2741602",
"blandings": "tt2211457",
"the bletchley circle": "tt2275990",
"blue bloods": "tt1595859",
"the blue rose": "tt2564734",
"bluestone 42": "tt2708572",
"boardwalk empire": "tt0979432",
"bobs burgers": "tt1561755",
"bones": "tt0460627",
"the boondocks": "tt0373732",
"bostons finest": "tt2724068",
"brickleberry": "tt2022713",
"the bridge us": "tt2406376 ",
"broad city": "tt2578560",
"broadchurch": "tt2249364",
"brooklyn nine-nine": "tt2467372",
"bullet in the face": "tt1772157",
"by any means": "tt2904568",
"californication": "tt0904208",
"the call centre": "tt2961422",
"camp": "tt2708560",
"capture": "tt3067882",
"the carrie diaries": "tt2056366",
"castle": "tt1219024",
"cedar cove": "tt2871832",
"charlie brookers weekly wipe": "tt2668792",
"chicago fire": "tt2261391",
"chicago pd": "tt2805096",
"chickens": "tt3130096",
"childrens hospital us": "tt1325113",
"chozen": "tt3221268",
"citizen khan": "tt2334302",
"the colbert report": "tt0458254",
"come fly with me": "tt1749004",
"comic book men": "tt2174367",
"community": "tt1439629",
"conan": "tt1637574",
"continuum": "tt1954347",
"cops": "tt0096563",
"cosmos a spacetime odyssey": "tt2395695",
"cougar town": "tt1441109",
"covert affairs": "tt1495708",
"craig ferguson": "tt0437729",
"the crazy ones": "tt2710104",
"criminal minds": "tt0452046",
"crisis": "tt2322158",
"crossbones": "tt2400631",
"crossing lines": "tt2427220",
"csi": "tt0247082",
"cuckoo": "tt2222352",
"the culture show": "tt1083512",
"curb your enthusiasm": "tt0264235",
"da vincis demons": "tt2094262",
"dads": "tt2647548",
"the daily show": "tt0115147",
"dallas": "tt1723760",
"dancing with the stars us": "tt0463398",
"danger 5": "tt1807165",
"dara o briains science club": "tt2510712",
"david attenboroughs africa": "tt2571774",
"david letterman": "tt0106053",
"deadliest catch": "tt0446809",
"defiance": "tt1034303",
"derek": "tt2616280",
"devious maids": "tt2226342",
"dick clarks new years rockin eve with ryan seacrest": "tt1571199",
"discovery channel": "tt2343178",
"doctor who": "tt0436992",
"doll and em": "tt2561882",
"downton abbey": "tt1606375",
"dracula us": "tt2296682",
"drifters": "tt3323824",
"drop dead diva": "tt1280822",
"drunk history": "tt2712612",
"duck quacks dont echo uk": "tt3475768",
"duets": "tt0134630",
"elementary": "tt2191671",
"emmy awards": "tt2262378",
"enlisted": "tt2741950",
"episodes": "tt1582350",
"eurovision song contest": "tt1864520",
"the exes": "tt1830888",
"face off": "tt1663641",
"the fall": "tt2294189",
"falling skies": "tt1462059",
"family guy": "tt0182576",
"fat tony and co": "tt3457530",
"fifth gear": "tt0324679",
"the following": "tt2071645",
"the fosters": "tt2262532",
"frankie": "tt2634230",
"franklin and bash": "tt1600199",
"fresh meat": "tt2058303",
"friends with better lives": "tt2742174",
"from dusk till dawn": "tt3337194",
"game of thrones": "tt0944947",
"the game": "tt0772137",
"gates": "tt1599357",
"get out alive": "tt2442494",
"getting on us": "tt2342652",
"girls": "tt1723816",
"glee": "tt1327801",
"the goldbergs": "tt2712740",
"good game": "tt0978036",
"the good wife": "tt1442462",
"graceland": "tt2393813",
"greys anatomy": "tt0413573",
"grimm": "tt1830617",
"ground floor": "tt2763286",
"growing up fisher": "tt2698984",
"hannibal": "tt2243973",
"hart of dixie": "tt1832979",
"have i got a bit more news for you": "tt0098820",
"have i got news for you": "tt0098820",
"haven": "tt1519931",
"the haves and the have nots": "tt2729716",
"hawaii five-0": "tt1600194",
"heading out": "tt2431738",
"helix": "tt2758950",
"hell on wheels": "tt1699748",
"hells kitchen us": "tt0437005",
"hemlock grove": "tt2309295",
"high school usa": "tt3012976",
"hinterland": "tt2575968",
"history channel documentaries": "tt1932730",
"hit the floor": "tt2368645",
"hitrecord on tv": "tt3453566",
"homeland": "tt1796960",
"hooters dream girls": "tt2459384",
"hostages": "tt2647258",
"hot in cleveland": "tt1583607",
"hotel hell": "tt2242025",
"house of cards": "tt1856010",
"house of lies": "tt1797404",
"how i met your mother": "tt0460649",
"in guantanamo": "tt0468094",
"in the flesh": "tt2480514",
"inside amy schumer": "tt2578508",
"inside no 9": "tt2674806",
"intelligence us": "tt2693776",
"its always sunny in philadelphia": "tt0472954",
"jamie private school girl": "tt3173854",
"jimmy fallon": "tt3444938",
"jimmy kimmel": "tt0320037",
"jonathan creek": "tt0118363",
"justified": "tt1489428",
"karl pilkington the moaning of life": "tt3277670",
"key and peele": "tt1981558",
"the killing": "tt1637727",
"king of the nerds": "tt2401129",
"kirstie": "tt2520946",
"kitchen nightmares": "tt0983514",
"kroll show": "tt1981538",
"l5": "tt0116811",
"lab rats": "tt1991564",
"last comic standing": "tt0364829",
"last man standing us": "tt1828327",
"law and order svu": "tt0203259",
"law and order uk": "tt1166893",
"the league": "tt1480684",
"legit": "tt2400391",
"level up": "tt1713501",
"line of duty": "tt2303687",
"the line": "tt0479700",
"the listener": "tt1181541",
"longmire": "tt1836037",
"looking": "tt2581458",
"lost girl": "tt1429449",
"louie": "tt1492966",
"louis theroux": "tt0217229",
"lucas bros moving company": "tt3042900",
"mad": "tt1718438",
"mad men": "tt0804503",
"major crimes": "tt1936532",
"man down": "tt3063454",
"maron": "tt2520512",
"marvels agents of s h i e l d": "tt2364582",
"masterchef us": "tt1694423",
"masters of sex": "tt2137109",
"melissa and joey": "tt1597420",
"men at work": "tt1942919",
"the mentalist": "tt1196946",
"the michael j fox show": "tt2338232",
"the middle": "tt1442464",
"midsomer murders": "tt0118401",
"mike and molly": "tt1608180",
"the millers": "tt2737290",
"the mimic": "tt2350760",
"the mindy project": "tt2211129",
"mistresses us": "tt2295809",
"mixology": "tt2727600",
"mixtape": "tt1499280",
"mock the week": "tt0463827",
"modern family": "tt1442437",
"mom": "tt2660806",
"monsterquest": "tt1170243",
"moone boy": "tt2319283",
"most shocking celebrity moments": "tt3437948",
"motive": "tt2443340",
"mr selfridge": "tt2310212",
"the musketeers": "tt2733252",
"mythbusters": "tt0383126",
"naked and afraid": "tt3007640",
"nashville": "tt2281375",
"national geographic": "tt0057775",
"national treasures": "tt0368891",
"ncis": "tt0364845",
"ncis los angeles": "tt1378167",
"the neighbors": "tt2182229",
"the nerdist": "tt2813676",
"never mind the buzzcocks uk": "tt0115286",
"new girl": "tt1826940",
"new tricks": "tt0362357",
"the newsroom": "tt1870479",
"newswipe with charlie brooker": "tt1405169",
"nick swardsons pretend time": "tt1721648",
"nova sciencenow": "tt0449461",
"ntsf sd suv": "tt1783495",
"nurse jackie": "tt1190689",
"once upon a time": "tt1843230",
"once upon a time in wonderland": "tt2802008",
"onion news network": "tt1717499",
"orange is the new black": "tt2372162",
"the originals": "tt2632424",
"orphan black": "tt2234222",
"packed to the rafters": "tt1132600",
"parenthood": "tt1416765",
"parks and recreation": "tt1266020",
"peaky blinders": "tt2442560",
"peep show": "tt0387764",
"the penguins of madagascar": "tt0892700",
"penn and teller bullshit": "tt0346369",
"perception": "tt1714204",
"person of interest": "tt1839578",
"personal affairs": "tt1156098",
"pioneer one": "tt1748166",
"played ca": "tt2886812",
"player attack": "tt2839082",
"plebs": "tt2731624",
"portlandia": "tt1780441",
"pretty little liars": "tt1578873",
"qi": "tt0380136",
"raised by wolves uk": "tt2350852",
"raising hope": "tt1615919",
"rake us": "tt1587000",
"ray donovan": "tt2249007",
"real time with bill maher": "tt0350448",
"rectify": "tt2183404",
"red dwarf": "tt0094535",
"the red road": "tt2505072",
"reign": "tt2710394",
"resurrection us": "tt2647586",
"rev": "tt1588221",
"revenge": "tt1837642",
"revolution": "tt2070791",
"richard hammonds crash course": "tt2004577",
"ripper street": "tt2183641",
"rizzoli and isles": "tt1551632",
"robot chicken": "tt0437745",
"rogue": "tt0479528",
"rookie blue": "tt1442065",
"the royal bodyguard": "tt1974934",
"royal institution christmas lectures": "tt0810719",
"royal pains": "tt1319735",
"rush": "tt1979320",
"saf3": "tt2497788",
"saint george": "tt3496994",
"salting the battlefield": "tt2904626",
"saturday night live": "tt0072562",
"saving hope": "tt1954804",
"scandal us": "tt1837576",
"the sci fi guys": "tt2071222",
"the secret policemans ball": "tt2317255",
"see dad run": "tt2382108",
"seed": "tt2429840",
"serangoon road": "tt2699780",
"seth meyers": "tt3513388",
"the shadow line": "tt1701920",
"shameless us": "tt1586680",
"sherlock": "tt1475582",
"siberia": "tt2935974",
"silent witness": "tt0115355",
"the simpsons": "tt0096697",
"single father": "tt1605467",
"sirens": "tt2484950",
"sleepy hollow": "tt0162661",
"the smoke": "tt3143398",
"so you think you can dance": "tt0472023",
"sons of anarchy": "tt1124373",
"the soul man": "tt2400129",
"the soup": "tt0421460",
"south park": "tt0121955",
"spicks and specks": "tt0448300",
"sports show with norm macdonald": "tt1885032",
"star-crossed": "tt2657262",
"star trek continues": "tt2732442",
"stargazing live": "tt1804155",
"strike back": "tt1492179",
"suburgatory": "tt1741256",
"suits": "tt1632701",
"super bowl": "tt1426337",
"super fun night": "tt2298477",
"supernatural": "tt0460681",
"suprnova": "tt0134983",
"surviving jack": "tt2395482",
"survivor": "tt0239195",
"switched at birth": "tt1758772",
"talking dead": "tt2089467",
"teen wolf": "tt1567432",
"those who kill us": "tt2188931",
"threesome": "tt0111418",
"the tomorrow people us": "tt2660734",
"tony awards": "tt2184336",
"top chef": "tt1427816",
"top gear": "tt1628033",
"top gear australia": "tt1251819",
"totally biased with w kamau bell": "tt2330549",
"tpb afk": "tt2608732",
"transporter the series": "tt1885102",
"trial and retribution": "tt1511543",
"trophy wife": "tt2400736",
"true blood": "tt0844441",
"true detective": "tt2356777",
"true justice": "tt1697033",
"the tunnel": "tt2711738",
"twisted": "tt2355844",
"two and a half men": "tt0369179",
"the ultimate fighter": "tt0445912",
"unchained reaction": "tt2230805",
"under the dome": "tt1553656",
"undercover boss us": "tt1442553",
"unforgettable": "tt1842530",
"the universe": "tt1051155",
"unnatural history": "tt1494829",
"upstairs downstairs": "tt0066722",
"us now": "tt1555154",
"utopia": "tt2384811",
"the valleys": "tt2745774",
"the vampire diaries": "tt1405406",
"veep": "tt1759761",
"the venture brothers": "tt0417373",
"vice": "tt2782710",
"vicious": "tt2582590",
"vikings us": "tt2306299",
"the village": "tt0368447",
"the voice": "tt1839337",
"w1a": "tt1861225",
"the walking dead": "tt1520211",
"wallander": "tt1178618",
"warehouse 13": "tt1132290",
"was it something i said": "tt1263806",
"watson and oliver": "tt1281286",
"web therapy": "tt1930123",
"whale wars": "tt1195419",
"white collar": "tt1358522",
"who do you think you are us": "tt1365047",
"whodunnit?": "tt2699226",
"wild boys": "tt1865572",
"wilfred us": "tt1703925",
"witches of east end": "tt2288064",
"wizards vs aliens": "tt2491332",
"workaholics": "tt1610527",
"working the engels": "tt3489108",
"world series of poker": "tt2733512",
"the wright way": "tt2649480",
"the wrong mans": "tt2603596",
"xiii the series": "tt1713938",
"the yes men fix the world": "tt1352852",
"yonderland": "tt2938522",
"you have been watching": "tt1470539",
"young apprentice": "tt1655081",
"young herriot": "tt1926955",
"youngers": "tt2783314",
"psych": "tt0491738",
"mind games": "tt2751064",
"great british railway journeys": "tt1578652",
"the plantagenets": "tt3610250",
"horizon": "tt0318224",
"timeshift": "tt0796171",
"life and death row": "tt2865070",
"new worlds": "tt3495652",
"great british journeys": "tt3018632",
"the crimson field": "tt3494220	",
"dispatches": "tt1043090",
"bang goes the theory": "tt1481440",
"the trip to italy": "tt2967006",
"timewatch": "tt0273026",
"nature": "tt0083452",
"triptank": "tt2380303",
"anger management": "tt1986770"
};


    App.Scrapers.Yts = Yts;
})();
