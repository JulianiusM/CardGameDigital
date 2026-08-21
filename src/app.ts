/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {TypeormStore} from "connect-typeorm";
import cookieParser from 'cookie-parser';
import express, {NextFunction, Request, Response} from 'express';
import flash from 'express-flash';
import session from 'express-session';
import createError from 'http-errors';
import logger from 'morgan';
import path from 'node:path';
import {version} from '../package.json';
import {logoutUserOidc, validateSession} from "./controller/userController";
import {handleGenericError} from './middleware/genericErrorHandler';
import {AppDataSource} from "./modules/database/dataSource";
import {Session} from "./modules/database/entities/session/Session";
import {asyncHandler} from "./modules/lib/asyncHandler";
import settings from './modules/settings';
import indexRouter from './routes';
import activityRouter from './routes/activity';
import apiRouter from './routes/api';
import driversRouter from './routes/drivers';
import eventRouter from './routes/event';
import guestsRouter from './routes/guests';
import helpRouter from './routes/help';
import packingRouter from './routes/packing';
import surveyRouter from './routes/survey';
import usersRouter from './routes/users';

const app = express();
app.disable("x-powered-by");

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({extended: true}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ensure dataSource is initialized before this
const sessionRepository = AppDataSource.getRepository(Session);

// If behind a proxy (Heroku/NGINX), enable this so secure cookies work:
app.set("trust proxy", 1);

app.use(
    session({
        secret: settings.value.sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: {
            // 1 day (match store TTL below)
            maxAge: 1000 * 60 * 60 * 24,
            secure: process.env.NODE_ENV === "production", // HTTPS only in prod
            sameSite: "lax",
        },
        store: new TypeormStore({
            cleanupLimit: 2,          // prune expired sessions periodically
            limitSubquery: false,
            ttl: 60 * 60 * 24,        // seconds (1 day)
        }).connect(sessionRepository),
    })
);

app.use(flash());

// Validate session on each request
app.use(asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    if (!await validateSession(req.session)) {
        // Session is not valid anymore --> force logout
        req.flash("error", "Session has expired");
        res.redirect(await logoutUserOidc(req.session));
        return;
    }
    next();
}));

app.use(function (req: Request, res: Response, next: NextFunction) {
    res.locals.profile = req.session.profile;
    res.locals.auth = req.session.auth;
    res.locals.version = version;
    res.locals.settings = {
        localLoginEnabled: settings.value.localLoginEnabled,
        oidcEnabled: settings.value.oidcEnabled,
        oidcName: settings.value.oidcName,
        rootUrl: settings.value.rootUrl,
        imprintUrl: settings.value.imprintUrl,
        privacyPolicyUrl: settings.value.privacyPolicyUrl,
    };
    res.locals.nxtUrl = req.query.next ?? req.baseUrl + req.path;
    next();
});

app.use('/', indexRouter);
app.use('/api', apiRouter);
app.use('/users', usersRouter);
app.use('/survey', surveyRouter);
app.use('/packing', packingRouter);
app.use('/activity', activityRouter);
app.use('/drivers', driversRouter);
app.use('/event', eventRouter);
app.use('/help', helpRouter);
app.use('/guest', guestsRouter);

app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// catch 404 and forward to error handler
app.use(function (req: Request, res: Response, next: NextFunction) {
    next(createError(404));
});

// error handler
app.use(handleGenericError);

export default app;