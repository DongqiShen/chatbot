import { tool } from "@openai/agents";
import { z } from "zod";
import type { AgentRuntimeContext } from "@/agents/types/context";
import { logger, serializeError } from "@/lib/logger";

async function geocodeCity(
  city: string
): Promise<{ latitude: number; longitude: number } | null> {
  const weatherLogger = logger.child({
    component: "agent.tool.weather",
    operation: "geocodeCity",
    city,
  });

  try {
    const response = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
    );

    if (!response.ok) {
      weatherLogger.warn("Geocoding request returned a non-OK status", {
        statusCode: response.status,
      });
      return null;
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      weatherLogger.warn("Geocoding request returned no results");
      return null;
    }

    const result = data.results[0];
    weatherLogger.info("Resolved city to coordinates", {
      latitude: result.latitude,
      longitude: result.longitude,
    });
    return {
      latitude: result.latitude,
      longitude: result.longitude,
    };
  } catch (error) {
    weatherLogger.error("Geocoding request failed", {
      error: serializeError(error),
    });
    return null;
  }
}

export function createGetWeatherAgentTool(context: AgentRuntimeContext) {
  return tool({
    name: "getWeather",
    description:
      "Get the current weather at a location. You can provide either coordinates or a city name.",
    parameters: z.object({
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      city: z
        .string()
        .describe("City name (e.g. 'San Francisco', 'New York', 'London')")
        .optional(),
    }),
    async execute(input) {
      const weatherLogger = logger.child({
        component: "agent.tool.weather",
        operation: "execute",
        chatId: context.chatId,
        userId: context.session.user?.id,
        selectedModel: context.selectedModel,
        city: input.city,
      });
      let latitude: number;
      let longitude: number;

      if (input.city) {
        const coords = await geocodeCity(input.city);
        if (!coords) {
          weatherLogger.warn(
            "Weather lookup failed because city could not be resolved"
          );
          return {
            error: `Could not find coordinates for "${input.city}". Please check the city name.`,
          };
        }

        latitude = coords.latitude;
        longitude = coords.longitude;
      } else if (
        input.latitude !== undefined &&
        input.longitude !== undefined
      ) {
        latitude = input.latitude;
        longitude = input.longitude;
      } else {
        weatherLogger.warn(
          "Weather lookup rejected because location input is incomplete",
          {
            latitude: input.latitude,
            longitude: input.longitude,
          }
        );
        return {
          error:
            "Please provide either a city name or both latitude and longitude coordinates.",
        };
      }

      const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m&hourly=temperature_2m&daily=sunrise,sunset&timezone=auto`
      );

      if (!response.ok) {
        weatherLogger.warn("Weather API returned a non-OK status", {
          latitude,
          longitude,
          statusCode: response.status,
        });
        return {
          error: "Weather service is currently unavailable.",
        };
      }

      const weatherData = await response.json();

      if (input.city) {
        weatherData.cityName = input.city;
      }

      weatherLogger.info("Weather lookup completed", {
        latitude,
        longitude,
        temperature: weatherData?.current?.temperature_2m,
      });
      return weatherData;
    },
  });
}
