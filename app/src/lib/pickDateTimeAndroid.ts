import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";

// Android has no combined date+time dialog — this chains the native date picker into the
// native time picker, resolving the combined Date, or null if either step is cancelled.
export function pickDateTimeAndroid(initial: Date): Promise<Date | null> {
  return new Promise((resolve) => {
    DateTimePickerAndroid.open({
      value: initial,
      mode: "date",
      onChange: (event, pickedDate) => {
        if (event.type !== "set" || !pickedDate) {
          resolve(null);
          return;
        }
        DateTimePickerAndroid.open({
          value: pickedDate,
          mode: "time",
          onChange: (timeEvent, pickedTime) => {
            if (timeEvent.type !== "set" || !pickedTime) {
              resolve(null);
              return;
            }
            const combined = new Date(pickedDate);
            combined.setHours(pickedTime.getHours(), pickedTime.getMinutes(), 0, 0);
            resolve(combined);
          },
        });
      },
    });
  });
}
