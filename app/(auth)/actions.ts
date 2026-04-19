"use server";

import { z } from "zod";

import { createUser, getUser } from "@/lib/db/queries";
import { logger, serializeError } from "@/lib/logger";

import { signIn } from "./auth";

const authFormSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export type LoginActionState = {
  status: "idle" | "in_progress" | "success" | "failed" | "invalid_data";
};

export const login = async (
  _: LoginActionState,
  formData: FormData
): Promise<LoginActionState> => {
  const authLogger = logger.child({ component: "auth", action: "login" });

  try {
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });

    authLogger.info("Login completed successfully");
    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      authLogger.warn("Login rejected due to invalid input", {
        issues: error.issues,
      });
      return { status: "invalid_data" };
    }

    authLogger.error("Login failed", {
      error: serializeError(error),
    });
    return { status: "failed" };
  }
};

export type RegisterActionState = {
  status:
    | "idle"
    | "in_progress"
    | "success"
    | "failed"
    | "user_exists"
    | "invalid_data";
};

export const register = async (
  _: RegisterActionState,
  formData: FormData
): Promise<RegisterActionState> => {
  const authLogger = logger.child({ component: "auth", action: "register" });

  try {
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    const [user] = await getUser(validatedData.email);

    if (user) {
      authLogger.warn("Registration rejected because user already exists");
      return { status: "user_exists" } as RegisterActionState;
    }
    await createUser(validatedData.email, validatedData.password);
    await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });

    authLogger.info("Registration completed successfully");
    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      authLogger.warn("Registration rejected due to invalid input", {
        issues: error.issues,
      });
      return { status: "invalid_data" };
    }

    authLogger.error("Registration failed", {
      error: serializeError(error),
    });
    return { status: "failed" };
  }
};
