const path = require('path');
const fsAsync = require('fs').promises;

const express = require('express');
const app = express();
const storage = require('./storage.json');

const port = 3001;

// set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(require('./middleware/middleware.basic-auth'));

// initialise the video-serving code
app.use(require('./video-file-server'));

app.use(express.static('public'));

app.get('*.:ext', async (req, res, next) => {
    const filetype = req.params.ext;
    const route = `${req.params['0']}.${filetype}`.split('/').filter(x => x.length > 0);

    const breadcrumbs = [];
    const currentParts = [];
    for (let i = 0; i < route.length; i++) {
        const folder = route[i];
        breadcrumbs.push({
            name: folder,
            route: '/' + [...currentParts, folder].join('/')
        })
        currentParts.push(folder);
    }

    const filename = route[route.length - 1];
    res.render('video', {
        pageTitle: `${filename}`,
        videoUrl: `/api/${req.params['0']}.${filetype}`,
	downloadUrl: `/download/${req.params['0']}.${filetype}`,
        route: breadcrumbs
    })
})

app.get('*', async (req, res, next) => {
    const route = req.params['0'].split('/').filter(x => x.length > 0);

    const breadcrumbs = [];
    const currentParts = [];
    for (let i = 0; i < route.length; i++) {
        const folder = route[i];
        breadcrumbs.push({
            name: folder,
            route: '/' + [...currentParts, folder].join('/')
        })
        currentParts.push(folder);
    }

    const directory = path.join(storage.rootpath, ...route);
    const folderItems = (await fsAsync.readdir(directory, { withFileTypes: true })).map(dirent => dirent.name);
    const locations = [];
    for (let i = 0; i < folderItems.length; i++) {
        const folderItem = folderItems[i];
        locations.push({
            name: folderItem,
            route: `/${[...route, folderItem].join('/')}`
        })
    }

    res.render('folder', {
        pageTitle: 'Cameras',
        route: breadcrumbs,
        locations: locations
    })
})

app.get('multi', async(req, res, next) => {
    res.json({message: 'hi'})
})

app.listen(port, () => {
    console.log(`*** Server listening on port ${port} ***`);
})
