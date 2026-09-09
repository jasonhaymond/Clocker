import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";

// Android has no combined date+time dialog — this chains the native date picker into the
// native time picker, resolving the combined Date, or null if either step is cancelled.
export function pickDateTimeAndroid(initial: Date): Promise<Date | null> {
  return new Promise((resolve) => {
    DateTimePickerAndroid.open({
      value: initial,
      mode: "date",
      onValueChange: (_event, pickedDate) => {
        DateTimePickerAndroid.open({
          value: pickedDate,
          mode: "time",
          onValueChange: (_timeEvent, pickedTime) => {
            const combined = new Date(pickedDate);
            combined.setHours(pickedTime.getHours(), pickedTime.getMinutes(), 0, 0);
            resolve(combined);
          },
          onDismiss: () => resolve(null),
        });
      },
      onDismiss: () => resolve(null),
    });
  });
}
