import { compare } from "bcrypt-ts";
import NextAuth, { type DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { DUMMY_PASSWORD } from "@/lib/constants";
import { createGuestUser, getUser } from "@/lib/db/queries";
import { logger, serializeError } from "@/lib/logger";
import { authConfig } from "./auth.config";

export type UserType = "guest" | "regular";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      type: UserType;
    } & DefaultSession["user"];
  }

  interface User {
    id?: string;
    email?: string | null;
    type: UserType;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    type: UserType;
  }
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const authLogger = logger.child({
          component: "auth",
          provider: "credentials",
        });
        const email = String(credentials.email ?? "");
        const password = String(credentials.password ?? "");
        const users = await getUser(email);

        if (users.length === 0) {
          await compare(password, DUMMY_PASSWORD);
          authLogger.warn("Credentials authorization failed", {
            reason: "user-not-found",
          });
          return null;
        }

        const [user] = users;

        if (!user.password) {
          await compare(password, DUMMY_PASSWORD);
          authLogger.warn("Credentials authorization failed", {
            reason: "missing-password",
            userId: user.id,
          });
          return null;
        }

        let passwordsMatch = false;

        try {
          passwordsMatch = await compare(password, user.password);
        } catch (error) {
          authLogger.error("Password comparison failed", {
            userId: user.id,
            error: serializeError(error),
          });
          return null;
        }

        if (!passwordsMatch) {
          authLogger.warn("Credentials authorization failed", {
            reason: "password-mismatch",
            userId: user.id,
          });
          return null;
        }

        authLogger.info("Credentials authorization succeeded", {
          userId: user.id,
        });
        return { ...user, type: "regular" };
      },
    }),
    Credentials({
      id: "guest",
      credentials: {},
      async authorize() {
        const guestAuthLogger = logger.child({
          component: "auth",
          provider: "guest",
        });
        const [guestUser] = await createGuestUser();
        guestAuthLogger.info("Guest user created", {
          userId: guestUser.id,
        });
        return { ...guestUser, type: "guest" };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.type = user.type;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.type = token.type;
      }

      return session;
    },
  },
});
