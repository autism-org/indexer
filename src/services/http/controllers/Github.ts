import { Request, Response, Router } from 'express';
import passport from 'passport';
import { Strategy as GhStrategy } from 'passport-github2';
import { calculateReputation, OAuthProvider } from '@interep/reputation';

import { Controller } from './interface';
import config from '../../../util/config';
import { getReceivedStars } from '../../../util/github';

const options = {
  clientID: config.ghClientId,
  clientSecret: config.ghClientSecret,
  callbackURL: config.ghCallbackUrl,
};

export class GithubController extends Controller {
  constructor() {
    super();
    passport.use(
      new GhStrategy(
        options,
        // @ts-ignore
        async (accessToken, refreshToken, profile, done) => {
          const {
            id: userId,
            username,
            _json: {
              followers,
              plan: { name: planName },
            },
          } = profile;

          const proPlan = planName === 'pro';
          const receivedStars = await getReceivedStars(username);
          const reputation = calculateReputation(OAuthProvider.GITHUB, {
            followers,
            receivedStars,
            proPlan,
          });

          // TODO: need for github_auths DB operation here?
          // const githubAuthDB = await this.call('db', 'getGithubAuth');
          //
          // await githubAuthDB.upsertOne({
          //   userId,
          //   username,
          //   displayName,
          //   followers,
          //   proPlan,
          //   receivedStars,
          // });

          return done(null, {
            userId,
            username,
            reputation,
          });
        }
      )
    );

    this.addRoutes();
  }

  addRoutes = () => {
    this._router.use(
      '/auth/github',
      Router()
        .get('', passport.authenticate('github', { scope: ['read:user', 'read:org'] }))
        .get('/callback', passport.authenticate('github', { failWithError: true }), this.callback)
        .get('/test', (req, res) => {
          res.json(req.user);
        })
    );
  };

  callback = (req: Request, res: Response) => {
    res.send('gh callback');
  };
}
