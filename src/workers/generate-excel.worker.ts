import { parentPort, workerData } from 'worker_threads';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';

// Define a type for your column definition if you don't have one elsewhere
interface ColumnDefinition {
  key: string;
  header: string;
  width?: number;
}

// Define a type for your data items
interface DataItem {
  [key: string]: any; // Allows for dynamic properties like 'phone-1', 'phone-2'
  phoneDetails?: { _id: string }[];
}

(async () => {
  try {
    const {
      data,
      columns,
      filePath,
      isKey = false,
    } = workerData as {
      data: DataItem[];
      columns: ColumnDefinition[];
      filePath?: string;
      isKey?: boolean;
    };
    console.log(
      'in worker, received data:',
      data ? data.length : 0,
      'items, columns:',
      columns ? columns.length : 0,
    );

    if (!Array.isArray(data) || !Array.isArray(columns)) {
      throw new Error('Invalid data or columns received in worker');
    }

    let processedColumns: ColumnDefinition[] = []; // This will be our final set of columns in order
    let maxPhoneColumns = 0;

    const shouldExpandPhone =
      columns.some(({ key }) => key === 'phone') &&
      data.some(
        ({ phoneDetails }) =>
          Array.isArray(phoneDetails) && phoneDetails.length,
      );

    if (shouldExpandPhone) {
      // 1. Transform data: Flatten phoneDetails into item properties
      //    and find the maximum number of phone numbers for any item.
      data.forEach((item) => {
        if (Array.isArray(item.phoneDetails)) {
          item.phoneDetails.forEach(
            ({ _id }: { _id: string }, index: number) => {
              item[`phone-${index + 1}`] = _id; // Ensure _id is the actual phone number string
              maxPhoneColumns = Math.max(index + 1, maxPhoneColumns);
            },
          );
        }
      });

      // 2. Create the definitions for the dynamic phone columns
      const dynamicPhoneColumns = Array.from(
        { length: maxPhoneColumns },
        (_, index) => ({
          key: `phone-${index + 1}`,
          header: `Phone ${index + 1}`,
          width: 20,
        }),
      );

      // 3. Build the new columns array, inserting dynamic phone columns
      //    at the position of the original 'phone' column.
      columns.forEach((col) => {
        if (col.key === 'phone') {
          processedColumns.push(...dynamicPhoneColumns); // Spread the array of phone columns here
        } else {
          processedColumns.push(col); // Add other columns as they are
        }
      });
    } else {
      // If no phone expansion is needed, just use the original columns
      processedColumns = [...columns];
    }

    let processedColumns2: ColumnDefinition[] = [];
    let maxfullNameColumns = 0;

    const shouldExpandfullNames =
      processedColumns.some(({ key }) => key === 'fullNames') &&
      data.some(
        ({ fullNames }) => Array.isArray(fullNames) && fullNames.length,
      );

    if (shouldExpandfullNames) {
      // 1. Transform data: Flatten fullNames into item properties
      //    and find the maximum number of fullNames for any item.
      data.forEach((item) => {
        if (Array.isArray(item.fullNames)) {
          item.fullNames.forEach((_id: string, index: number) => {
            item[`fullName-${index + 1}`] = _id; // Ensure _id is the actual fullNames string
            maxfullNameColumns = Math.max(index + 1, maxfullNameColumns);
          });
        }
      });

      // 2. Create the definitions for the dynamic fullName columns
      const dynamicfullNameColumns = Array.from(
        { length: maxfullNameColumns },
        (_, index) => ({
          key: `fullName-${index + 1}`,
          header: `fullName ${index + 1}`,
          width: 20,
        }),
      );

      // 3. Build the new columns array, inserting dynamic fullName columns
      //    at the position of the original 'fullNames' column.
      processedColumns.forEach((col) => {
        if (col.key === 'fullNames') {
          processedColumns2.push(...dynamicfullNameColumns); // Spread the array of fullName columns here
        } else {
          processedColumns2.push(col); // Add other columns as they are
        }
      });
    } else {
      // If no phone expansion is needed, just use the original columns
      processedColumns2 = [...processedColumns];
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Data');

    worksheet.columns = processedColumns2.map((col) => ({
      header: isKey
        ? col.header
            .replace(/([A-Z])/g, ' $1') // Add space before capital letters
            .replace(/^./, (str) => str.toUpperCase()) // Capitalize first letter
        : col.header,
      key: col.key,
      width: col.width || 20,
    }));

    // Apply bold style to header row
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
      if (cell) {
        // Ensure cell exists
        cell.font = { bold: true };
      }
    });

    // Data items now have 'phone-1', 'phone-2' properties if expansion occurred
    worksheet.addRows(data);

    const tempfilePath = filePath
      ? path.resolve(filePath)
      : path.resolve(process.cwd(), 'exports', `data_${Date.now()}.xlsx`); // Use process.cwd() for better base path

    // Ensure 'exports' directory exists
    const exportDir = path.dirname(tempfilePath);
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
      console.log(`Created directory: ${exportDir}`);
    }

    console.log('Attempting to write Excel file to: ', tempfilePath);

    await workbook.xlsx.writeFile(tempfilePath);
    console.log('Excel file written successfully.');

    // Get file stats
    const stats = fs.statSync(tempfilePath);

    parentPort!.postMessage({
      // Added non-null assertion for parentPort
      success: true,
      filePath: tempfilePath,
      fileSize: stats.size,
    });
  } catch (error: any) {
    // Catch as 'any' or 'unknown' and then check
    console.error('Worker encountered an error:', error.message);
    console.error('Stack trace:', error.stack); // Log stack trace for more details
    parentPort!.postMessage({ success: false, error: error.message }); // Added non-null assertion
  }
})();
